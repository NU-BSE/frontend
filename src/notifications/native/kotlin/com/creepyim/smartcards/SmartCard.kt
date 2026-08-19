package com.creepyim.smartcards

import org.json.JSONObject

/**
 * A card and the cards it can become.
 *
 * Parsed from the JSON the JavaScript side sends. The whole graph is carried
 * so a press can be handled entirely inside the BroadcastReceiver — no JS
 * runtime, no Activity, nothing for Doze to defer.
 */
data class SmartCardAction(
    val id: String,
    val label: String,
    /** Serialized next card, or null for an action that ends the chain. */
    val nextJson: String?,
)

data class SmartCard(
    val title: String,
    val text: String,
    val detail: String?,
    val autoCancel: Boolean,
    val actions: List<SmartCardAction>,
) {
    companion object {
        /** Android renders at most three; more would be built and never shown. */
        const val MAX_ACTIONS = 3

        /**
         * Parse a card, or throw with the reason.
         *
         * Deliberately strict. A card that renders with an empty title or a
         * button that leads nowhere is worse than one that never posts: the
         * user cannot tell a broken notification from a finished workflow.
         */
        @Throws(IllegalArgumentException::class)
        fun parse(json: String): SmartCard = fromObject(JSONObject(json))

        private fun fromObject(root: JSONObject): SmartCard {
            val title = root.optString("title").trim()
            require(title.isNotEmpty()) { "card.title is missing" }

            val actionsJson = root.optJSONArray("actions")
            val actions = mutableListOf<SmartCardAction>()
            if (actionsJson != null) {
                require(actionsJson.length() <= MAX_ACTIONS) {
                    "card has ${actionsJson.length()} actions; Android shows at most $MAX_ACTIONS"
                }
                for (index in 0 until actionsJson.length()) {
                    val entry = actionsJson.getJSONObject(index)
                    val id = entry.optString("id").trim()
                    require(id.isNotEmpty()) { "card.actions[$index].id is missing" }

                    // Keep the next card as text: it is re-parsed only if the
                    // user presses this button, and it travels through a
                    // PendingIntent extra either way.
                    val next = entry.optJSONObject("next")
                    actions.add(
                        SmartCardAction(
                            id = id,
                            label = entry.optString("label").ifBlank { id },
                            nextJson = next?.toString(),
                        ),
                    )
                }
            }

            return SmartCard(
                title = title,
                text = root.optString("text").trim(),
                detail = root.optString("detail").trim().ifBlank { null },
                autoCancel = root.optBoolean("autoCancel", false),
                actions = actions,
            )
        }
    }
}
