package com.creepyim.mcp.resolver.detector

import com.creepyim.mcp.resolver.context.RepositoryContext
import com.creepyim.mcp.resolver.model.McpRuntime
import com.creepyim.mcp.resolver.util.ReadmeParser
import com.creepyim.mcp.resolver.util.Toml
import java.nio.file.Files

/**
 * Detects Python MCP server projects.
 *
 * Evidence order:
 *   1. explicit MCP config (README `mcpServers` JSON);
 *   2. `[project.scripts]` (PEP 621) / `[tool.poetry.scripts]` entrypoints;
 *   3. module entrypoint (`<module>/__main__.py`);
 *   4. setup.py / setup.cfg console scripts;
 *   5. heuristics.
 */
class PythonMcpDetector : McpProjectDetector {

    override val runtime: McpRuntime = McpRuntime.PYTHON

    override fun detect(context: RepositoryContext): DetectionResult? {
        val hasPyProject = context.exists("pyproject.toml")
        val hasRequirements = context.exists("requirements.txt")
        val hasSetupPy = context.exists("setup.py")
        val hasSetupCfg = context.exists("setup.cfg")
        val hasUvLock = context.exists("uv.lock")
        val hasPoetryLock = context.exists("poetry.lock")

        if (!hasPyProject && !hasRequirements && !hasSetupPy && !hasSetupCfg) return null

        val evidence = mutableListOf<String>()
        var confidence = 0.2

        if (hasPyProject) evidence += "pyproject.toml"
        if (hasRequirements) evidence += "requirements.txt"
        if (hasUvLock) evidence += "uv.lock"
        if (hasPoetryLock) evidence += "poetry.lock"

        val candidates = mutableListOf<LaunchCandidate>()

        // 1. Explicit MCP config in the README.
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

        val tomlText = context.readText("pyproject.toml")
        val toml = tomlText?.let { Toml.parse(it) }

        // 2. Declared console scripts.
        val pepScripts = toml?.let { Toml.stringTable(it, "project.scripts") } ?: emptyMap()
        val poetryScripts = toml?.let {
            Toml.stringTable(it.getTable("tool")?.getTable("poetry"), "scripts")
        } ?: emptyMap()

        if (pepScripts.isNotEmpty()) {
            confidence = (confidence + 0.3).coerceAtMost(1.0)
            evidence += "[project.scripts]: ${pepScripts.keys.joinToString(", ")}"
            val scriptName = mostLikelyMcpEntry(pepScripts.keys)
            candidates += buildScriptCandidate(scriptName, context, hasUvLock, hasPoetryLock, "declared in pyproject.toml [project.scripts]")
        } else if (poetryScripts.isNotEmpty()) {
            confidence = (confidence + 0.3).coerceAtMost(1.0)
            evidence += "[tool.poetry.scripts]: ${poetryScripts.keys.joinToString(", ")}"
            val scriptName = mostLikelyMcpEntry(poetryScripts.keys)
            candidates += LaunchCandidate(
                command = "poetry",
                args = listOf("run", scriptName),
                priority = 2,
                requiresPreparation = true,
                description = "console script via poetry",
            )
        }

        // 3. Module entrypoint (`python -m <package>`).
        val module = findModule(context)
        if (module != null) {
            confidence = (confidence + 0.15).coerceAtMost(1.0)
            evidence += "module entrypoint: $module"
            candidates += LaunchCandidate(
                command = "python",
                args = listOf("-m", module),
                priority = 3,
                description = "module entrypoint ($module)",
            )
        }

        // 4. setup.py / setup.cfg console scripts.
        val setupScripts = parseSetupConsoleScripts(context)
        if (setupScripts.isNotEmpty()) {
            evidence += "setup console scripts: ${setupScripts.joinToString(", ")}"
            candidates += LaunchCandidate(
                command = "python",
                args = listOf("-m", setupScripts.first()),
                priority = 4,
                requiresPreparation = true,
                description = "console script from setup.py/setup.cfg",
            )
        }

        if (candidates.isEmpty()) {
            evidence += "Python project but no launchable entrypoint found"
            return DetectionResult(runtime, confidence.coerceAtMost(1.0), evidence, emptyList())
        }

        return DetectionResult(
            runtime = runtime,
            confidence = confidence.coerceAtMost(1.0),
            evidence = evidence,
            candidates = candidates,
        )
    }

    private fun buildScriptCandidate(
        scriptName: String,
        context: RepositoryContext,
        hasUvLock: Boolean,
        hasPoetryLock: Boolean,
        description: String,
    ): LaunchCandidate {
        val hasToolUv = context.readText("pyproject.toml")
            ?.let { Toml.parse(it) }
            ?.getTable("tool")?.getTable("uv") != null
        val isUv = hasUvLock || hasToolUv

        return if (isUv) {
            LaunchCandidate(
                command = "uv",
                args = listOf("run", scriptName),
                priority = 2,
                requiresPreparation = true,
                description = "$description (uv project)",
            )
        } else {
            LaunchCandidate(
                command = "python",
                args = listOf("-m", scriptName),
                priority = 2,
                requiresPreparation = true,
                description = description,
            )
        }
    }

    /** Prefers the entry that looks like the project's MCP server name. */
    private fun mostLikelyMcpEntry(keys: Set<String>): String {
        return keys.firstOrNull { "mcp" in it.lowercase() } ?: keys.first()
    }

    private fun findModule(context: RepositoryContext): String? {
        // A package directory at the repository root with an __init__.py.
        for (path in context.listFiles()) {
            if (!Files.isDirectory(path)) continue
            val name = path.fileName?.toString() ?: continue
            if (name.startsWith(".") || name in listOf("node_modules", "venv", ".venv", "tests", "test", "docs")) continue
            if (context.exists("$name/__init__.py") || context.exists("$name/__main__.py")) {
                return name
            }
        }
        return null
    }

    private fun parseSetupConsoleScripts(context: RepositoryContext): List<String> {
        val result = mutableListOf<String>()
        val cfg = context.readText("setup.cfg")
        if (cfg != null) {
            val section = Regex("""\[options\.entry_points\.console_scripts]""")
            val lines = cfg.lineSequence()
            var inSection = false
            for (line in lines) {
                val trimmed = line.trim()
                if (section.containsMatchIn(line)) {
                    inSection = true
                    continue
                }
                if (inSection && trimmed.startsWith("[") && trimmed.endsWith("]")) break
                if (inSection && trimmed.isNotEmpty() && !trimmed.startsWith("#")) {
                    val name = trimmed.substringBefore("=").trim()
                    if (name.isNotBlank()) result += name
                }
            }
        }
        return result
    }
}