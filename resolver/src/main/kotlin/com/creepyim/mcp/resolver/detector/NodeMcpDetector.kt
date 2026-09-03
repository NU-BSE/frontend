package com.creepyim.mcp.resolver.detector

import com.creepyim.mcp.resolver.context.RepositoryContext
import com.creepyim.mcp.resolver.model.McpRuntime
import com.creepyim.mcp.resolver.util.Json
import com.creepyim.mcp.resolver.util.ReadmeParser
import java.nio.file.Files
import java.nio.file.Path

/**
 * Detects Node.js / TypeScript MCP server projects.
 *
 * Evidence is used in the order mandated by the resolution strategy:
 *   1. explicit MCP config (README `mcpServers` JSON);
 *   2. package executable metadata (`package.json.bin`);
 *   3. manifest entrypoint (`package.json.main`);
 *   4. build configuration / scripts;
 *   5. heuristics (existing entrypoint files).
 */
class NodeMcpDetector : McpProjectDetector {

    override val runtime: McpRuntime = McpRuntime.NODE

    private val MCP_DEPENDENCY = Regex(
        """(^@modelcontextprotocol/|(^|\/)mcp-|^@mcp/|@modelcontextprotocol|^mcp$|mcp-|modelcontextprotocol)""",
        RegexOption.IGNORE_CASE,
    )

    override fun detect(context: RepositoryContext): DetectionResult? {
        val packageJson = context.readText("package.json") ?: return null
        val root = Json.parse(packageJson) ?: return null

        val evidence = mutableListOf<String>()
        var confidence = 0.2

        val name = Json.text(root, "name")
        val bin = Json.obj(root, "bin")
        val binString = Json.text(root, "bin")
        val main = Json.text(root, "main")
        val type = Json.text(root, "type")
        val private = Json.has(root, "private") && Json.text(root, "private") == "true"
        val scripts = Json.obj(root, "scripts")

        val lockfile = detectLockfile(context)
        if (lockfile != null) evidence += "lockfile: $lockfile"

        val mcpDependencies = findMcpDependencies(root)
        if (mcpDependencies.isNotEmpty()) {
            confidence += 0.25
            evidence += "MCP dependency: ${mcpDependencies.joinToString(", ")}"
        }

        val candidates = mutableListOf<LaunchCandidate>()

        // 1. Explicit MCP config in the README — strongest evidence.
        ReadmeParser.find(context)?.let { readme ->
            confidence = (confidence + 0.35).coerceAtMost(1.0)
            evidence += "README MCP config: ${readme.command} ${readme.args.joinToString(" ")}"
            candidates += LaunchCandidate(
                command = readme.command,
                args = readme.args,
                workingDirectory = context.root,
                priority = 1,
                description = "command documented in ${readme.sourceFile}",
            )
        }

        // 2. Official executable from `bin`.
        val binEntry = resolveBinEntry(name, bin, binString)
        if (binEntry != null) {
            confidence = (confidence + 0.25).coerceAtMost(1.0)
            evidence += "package.json bin: ${binEntry.relativePath}"
            val binFile = context.file(binEntry.relativePath)
            val needsBuild = !Files.isRegularFile(binFile) && Files.isDirectory(context.file("dist"))
            candidates += LaunchCandidate(
                command = "node",
                args = listOf(binEntry.relativePath),
                workingDirectory = context.root,
                priority = 2,
                requiresPreparation = needsBuild,
                description = "executable from package.json bin (${binEntry.relativePath})",
            )
            if (name != null && !private) {
                candidates += LaunchCandidate(
                    command = "npx",
                    args = listOf("-y", name),
                    priority = 3,
                    description = "published package via npx",
                )
            }
        }

        // 3. Manifest entrypoint.
        if (main != null && binEntry == null) {
            confidence = (confidence + 0.15).coerceAtMost(1.0)
            evidence += "package.json main: $main"
            candidates += LaunchCandidate(
                command = "node",
                args = listOf(main),
                workingDirectory = context.root,
                priority = 4,
                description = "entrypoint from package.json main",
            )
        }

        // 4. Scripts — dev convenience, lowest preference.
        if (binEntry == null && main == null && scripts != null) {
            for (scriptName in listOf("mcp", "start", "serve", "main")) {
                if (Json.text(scripts, scriptName) != null) {
                    evidence += "package.json script: $scriptName"
                    candidates += LaunchCandidate(
                        command = "npm",
                        args = listOf("run", scriptName),
                        workingDirectory = context.root,
                        priority = 5,
                        requiresPreparation = true,
                        description = "npm script '$scriptName'",
                    )
                    break
                }
            }
        }

        // 5. Heuristics: an already-built entrypoint.
        if (context.exists("dist/index.js")) {
            evidence += "built entrypoint: dist/index.js"
            candidates += LaunchCandidate(
                command = "node",
                args = listOf("dist/index.js"),
                workingDirectory = context.root,
                priority = 6,
                description = "built entrypoint dist/index.js",
            )
        }
        if (context.exists("index.js")) {
            evidence += "entrypoint: index.js"
            candidates += LaunchCandidate(
                command = "node",
                args = listOf("index.js"),
                workingDirectory = context.root,
                priority = 7,
                description = "entrypoint index.js",
            )
        }

        if (candidates.isEmpty()) {
            evidence += "Node project but no launchable entrypoint found"
            return DetectionResult(runtime, confidence.coerceAtMost(1.0), evidence, emptyList())
        }

        return DetectionResult(
            runtime = runtime,
            confidence = confidence.coerceAtMost(1.0),
            evidence = evidence,
            candidates = candidates,
        )
    }

    private fun detectLockfile(context: RepositoryContext): String? {
        val candidates = listOf(
            "package-lock.json" to "npm",
            "pnpm-lock.yaml" to "pnpm",
            "yarn.lock" to "yarn",
            "bun.lock" to "bun",
            "bun.lockb" to "bun",
        )
        return candidates.firstOrNull { (file, _) -> context.exists(file) }?.second
    }

    private fun findMcpDependencies(root: com.fasterxml.jackson.databind.JsonNode): List<String> {
        val result = mutableListOf<String>()
        for (field in listOf("dependencies", "devDependencies", "peerDependencies", "optionalDependencies")) {
            val deps = Json.obj(root, field) ?: continue
            for (dep in deps.fieldNames()) {
                if (MCP_DEPENDENCY.containsMatchIn(dep)) result += dep
            }
        }
        return result
    }

    private fun resolveBinEntry(
        packageName: String?,
        bin: com.fasterxml.jackson.databind.JsonNode?,
        binString: String?,
    ): BinEntry? {
        if (binString != null) {
            return BinEntry(binString, binString)
        }
        if (bin == null || !bin.isObject) return null
        if (bin.isEmpty) return null

        val preferredKey = packageName?.substringAfterLast("/")
        val entries = bin.fieldNames().asSequence().toList()
        val key = entries.firstOrNull { it == preferredKey } ?: entries.first()
        val path = Json.text(bin, key) ?: return null
        return BinEntry(key, path)
    }

    private data class BinEntry(val name: String, val relativePath: String)
}