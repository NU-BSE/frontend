package com.creepyim.mcp.resolver.util

import com.creepyim.mcp.resolver.context.RepositoryContext

/**
 * Launch command extracted from documentation.
 *
 * Only *structured* evidence is used: an `mcpServers` JSON config object with a
 * `command` string and optional `args` array, or a simple, unambiguous
 * `<runner> <package>` invocation on its own line. Arbitrary shell code in a
 * README is never executed and never copied into a `/bin/sh -c` — `command`
 * and `args` stay strictly separated.
 */
data class ReadmeLaunch(
    val command: String,
    val args: List<String>,
    val sourceFile: String,
    val snippet: String,
)

object ReadmeParser {

    private val README_NAMES = listOf(
        "README.md",
        "README.rst",
        "README.txt",
        "README",
        "docs/README.md",
        "docs/index.md",
    )

    private val SAFE_RUNNERS = mapOf(
        "npx" to 2,
        "npx.cmd" to 2,
        "pnpm dlx" to 2,
        "yarn dlx" to 2,
        "bunx" to 2,
        "uv run" to 2,
        "poetry run" to 2,
        "python -m" to 2,
        "python3 -m" to 2,
        "node" to 1,
        "deno" to 1,
        "bun" to 1,
    )

    fun find(context: RepositoryContext): ReadmeLaunch? {
        for (name in README_NAMES) {
            val content = context.readText(name) ?: continue
            val fromJson = extractMcpServersConfig(content, name)
            if (fromJson != null) return fromJson
            val fromLine = extractSafeRunnerLine(content, name)
            if (fromLine != null) return fromLine
        }
        return null
    }

    /**
     * Looks for a JSON object in the README that looks like an MCP client
     * configuration, e.g.:
     *
     * ```
     * "mcpServers": {
     *   "example": { "command": "npx", "args": ["-y", "@example/mcp-server"] }
     * }
     * ```
     *
     * Prefers the shortest JSON object containing a `command` string and a
     * sibling `mcpServers` or `command`/`args` pair.
     */
    private fun extractMcpServersConfig(content: String, fileName: String): ReadmeLaunch? {
        val candidates = mutableListOf<ReadmeLaunch>()

        // 1. Complete fenced JSON blocks.
        val fenced = Regex("```(?:json)?\\s*\\n([\\s\\S]*?)\\n```").findAll(content)
        for (match in fenced) {
            val node = Json.parse(match.groupValues[1]) ?: continue
            val launch = launchFromJson(node, fileName, match.groupValues[1].trim()) ?: continue
            candidates += launch
        }

        // 2. Standalone `{ ... }` objects containing "command" and "args".
        val objectRegex = Regex("""\{[^{}]*"command"\s*:\s*"[^"]+"[^{}]*\}""")
        for (match in objectRegex.findAll(content)) {
            val node = Json.parse(match.value) ?: continue
            val launch = launchFromJson(node, fileName, match.value.trim()) ?: continue
            candidates += launch
        }

        return candidates.minByOrNull { it.snippet.length }
    }

    private fun launchFromJson(node: com.fasterxml.jackson.databind.JsonNode, fileName: String, snippet: String): ReadmeLaunch? {
        val direct = objectCommand(node)
        if (direct != null) return direct

        val servers = Json.obj(node, "mcpServers")
        if (servers != null && servers.isObject) {
            for (server in servers) {
                val launch = objectCommand(server) ?: continue
                if (launch.args.isNotEmpty()) return launch
            }
        }
        return null
    }

    private fun objectCommand(node: com.fasterxml.jackson.databind.JsonNode): ReadmeLaunch? {
        if (node == null || !node.isObject) return null
        val command = Json.text(node, "command") ?: return null
        val args = Json.textArray(node, "args") ?: emptyList()
        if (!CommandSafety.validateCommand(command, null) || !CommandSafety.validateArgs(args)) return null
        return ReadmeLaunch(command, args, "README", node.toString())
    }

    /**
     * Falls back to a bare `<runner> <package>` invocation on its own line.
     * The runner token is validated against a known allow-list so an arbitrary
     * shell line in the README can never become an executable command.
     */
    private fun extractSafeRunnerLine(content: String, fileName: String): ReadmeLaunch? {
        val codeLine = Regex("""^\s*[`>]*\s*([A-Za-z0-9._-]+(?: [A-Za-z0-9._-]+)?)\s+([@A-Za-z0-9._~/-]+)\s*$""")
        for (line in content.lineSequence()) {
            val match = codeLine.find(line) ?: continue
            val runner = match.groupValues[1].trim()
            val target = match.groupValues[2].trim()
            val minArgs = SAFE_RUNNERS[runner] ?: continue
            if (runner.startsWith("npx") && (target.startsWith("@") || !target.contains("/"))) {
                return ReadmeLaunch(runner, listOf("-y", target), fileName, line.trim())
            }
            if (runner == "uv run" || runner == "poetry run") {
                return ReadmeLaunch(runner.split(" ")[0], listOf("run", target), fileName, line.trim())
            }
            if (runner == "python -m" || runner == "python3 -m") {
                return ReadmeLaunch(runner.split(" ")[0], listOf("-m", target), fileName, line.trim())
            }
            if (runner == "node" || runner == "deno" || runner == "bun") {
                return ReadmeLaunch(runner, listOf(target), fileName, line.trim())
            }
        }
        return null
    }
}