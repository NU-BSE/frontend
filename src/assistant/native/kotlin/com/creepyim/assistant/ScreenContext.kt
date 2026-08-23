package com.creepyim.assistant

import android.app.assist.AssistContent
import android.app.assist.AssistStructure
import android.view.View
import org.json.JSONArray
import org.json.JSONObject

/**
 * Flattens an AssistStructure into the shape the agent consumes.
 *
 * The raw structure is a tree of every view in every window, including
 * decorations, empty containers and off-screen nodes. Handed to a model whole
 * it is mostly noise and easily tens of thousands of tokens, so this walk
 * keeps only nodes that carry something a reader could act on — text, a hint,
 * or a content description — and drops the rest.
 *
 * What is deliberately NOT collected: view ids, input types, autofill hints
 * and anything from a node marked as containing sensitive data. This runs over
 * whatever the user happened to have on screen, which may be a banking app or
 * a password manager, so the extraction is narrow by construction rather than
 * filtered afterwards.
 */
object ScreenContextExtractor {

    /** Hard ceiling on nodes. A list screen can hold thousands. */
    private const val MAX_NODES = 300

    /** Nodes deeper than this are structure, not content. */
    private const val MAX_DEPTH = 40

    fun extract(structure: AssistStructure?, content: AssistContent?): JSONObject {
        val root = JSONObject()
        val nodes = JSONArray()

        val component = structure?.activityComponent
        root.put("packageName", component?.packageName ?: JSONObject.NULL)
        root.put("activityName", component?.className ?: JSONObject.NULL)

        if (structure != null) {
            var budget = MAX_NODES
            for (i in 0 until structure.windowNodeCount) {
                if (budget <= 0) break
                val window = structure.getWindowNodeAt(i)
                budget = walk(window.rootViewNode, nodes, budget, 0)
                if (root.isNull("title")) {
                    window.title?.let { root.put("title", it.toString()) }
                }
            }
            root.put("truncated", budget <= 0)
        } else {
            root.put("truncated", false)
        }

        root.put("nodes", nodes)

        /*
         * AssistContent carries what the app itself chose to publish about the
         * current screen — a web URL, or structured JSON-LD. That is a far
         * better signal than scraped text when the app provides it, because
         * the app is stating its own context rather than us inferring it.
         */
        content?.webUri?.let { root.put("url", it.toString()) }
        content?.structuredData?.let { root.put("structuredData", it) }

        return root
    }

    private fun walk(
        node: AssistStructure.ViewNode?,
        out: JSONArray,
        budgetIn: Int,
        depth: Int,
    ): Int {
        if (node == null || budgetIn <= 0 || depth > MAX_DEPTH) return budgetIn
        var budget = budgetIn

        // An invisible node is not on screen, whatever the tree says.
        if (node.visibility != View.VISIBLE) return budget

        val text = node.text?.toString()?.trim()
        val hint = node.hint?.trim()
        val description = node.contentDescription?.toString()?.trim()

        if (!text.isNullOrEmpty() || !hint.isNullOrEmpty() || !description.isNullOrEmpty()) {
            val entry = JSONObject()
            if (!text.isNullOrEmpty()) entry.put("text", text)
            if (!hint.isNullOrEmpty()) entry.put("hint", hint)
            if (!description.isNullOrEmpty()) entry.put("contentDescription", description)
            node.className?.let { entry.put("className", it) }
            node.webDomain?.let { if (it.isNotEmpty()) entry.put("webDomain", it) }

            val bounds = JSONObject()
                .put("left", node.left)
                .put("top", node.top)
                .put("right", node.left + node.width)
                .put("bottom", node.top + node.height)
            entry.put("bounds", bounds)

            out.put(entry)
            budget -= 1
        }

        for (i in 0 until node.childCount) {
            if (budget <= 0) break
            budget = walk(node.getChildAt(i), out, budget, depth + 1)
        }
        return budget
    }
}

/**
 * The most recent assist context, held for the JS side to collect.
 *
 * A session is created and destroyed by the platform around each invocation,
 * and React Native may not be running when one arrives, so the context cannot
 * be pushed straight to JS. It is parked here instead and read through
 * getAssistContext().
 *
 * Exactly one is kept. Assist context is a snapshot of what was on screen at a
 * moment; a queue of stale screens would let the agent answer about a screen
 * the user has already left, which is worse than having nothing.
 */
object ScreenContextStore {

    @Volatile
    private var latest: String? = null

    @Volatile
    private var capturedAt: Long = 0L

    /** How long a captured screen is considered to still describe "now". */
    private const val FRESHNESS_MS = 5 * 60 * 1000L

    fun put(json: JSONObject) {
        latest = json.toString()
        capturedAt = System.currentTimeMillis()
    }

    /**
     * The last capture, or null when there is none or it has gone stale.
     *
     * Staleness is enforced here rather than left to the caller: an assistant
     * that answers about a screen from an hour ago is confidently wrong, which
     * is the failure mode worth designing out.
     */
    fun take(): String? {
        val value = latest ?: return null
        if (System.currentTimeMillis() - capturedAt > FRESHNESS_MS) {
            latest = null
            return null
        }
        return value
    }

    fun clear() {
        latest = null
        capturedAt = 0L
    }
}
