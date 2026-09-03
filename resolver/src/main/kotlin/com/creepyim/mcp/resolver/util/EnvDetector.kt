package com.creepyim.mcp.resolver.util

import com.creepyim.mcp.resolver.context.RepositoryContext
import com.creepyim.mcp.resolver.model.RequiredEnvironmentVariable
import java.nio.file.Files

/**
 * Static, bounded analysis of which environment variables an MCP server needs.
 *
 * It reports *names* only — never values and never secrets. Callers decide how
 * to source the actual values. Sources of truth, in order:
 *
 * 1. `.env.example` / `.env.sample` / `.env.template` files (explicit declaration);
 * 2. references in source code (`process.env.X`, `os.getenv("X")`,
 *    `System.getenv("X")`).
 */
object EnvDetector {

    private val ENV_FILE_NAMES = listOf(
        ".env.example",
        ".env.sample",
        ".env.template",
        ".env.defaults",
        ".env.dist",
    )

    private val PROCESS_ENV = Regex("""process\.env\.([A-Z_][A-Z0-9_]*)""")
    private val PROCESS_ENV_BRACKET = Regex("""process\.env\[\s*["']([A-Z_][A-Z0-9_]*)["']\s*]""")
    private val PYTHON_GETENV = Regex("""os\.(?:getenv|environ\.get)\(\s*["']([A-Z_][A-Z0-9_]*)["']""")
    private val PYTHON_ENVIRON = Regex("""os\.environ\[\s*["']([A-Z_][A-Z0-9_]*)["']\s*]""")
    private val JVM_GETENV = Regex("""System\.getenv\(\s*["']([A-Z_][A-Z0-9_]*)["']\s*\)""")

    private val ENV_NAME = Regex("""^([A-Z_][A-Z0-9_]*)=(.*)$""")

    private const val MAX_SCANNED_FILES = 300
    private const val MAX_VARIABLES = 32

    fun detect(context: RepositoryContext): List<RequiredEnvironmentVariable> {
        val declared = mutableMapOf<String, RequiredEnvironmentVariable>()
        val referenced = linkedSetOf<String>()

        // 1. Explicit declarations (.env.example and friends).
        for (name in ENV_FILE_NAMES) {
            context.readText(name)?.let { parseEnvFile(it, declared) }
        }

        // 2. Source references (bounded walk, excludes vendored dirs).
        scanSources(context) { content ->
            for (regex in listOf(PROCESS_ENV, PROCESS_ENV_BRACKET, PYTHON_GETENV, PYTHON_ENVIRON, JVM_GETENV)) {
                regex.findAll(content).forEach { match ->
                    referenced += match.groupValues[1]
                }
            }
        }

        val seen = linkedSetOf<String>()
        val result = mutableListOf<RequiredEnvironmentVariable>()

        for (name in declared.keys + referenced) {
            if (!seen.add(name)) continue
            if (result.size >= MAX_VARIABLES) break
            val declaredVar = declared[name]
            result += RequiredEnvironmentVariable(
                name = name,
                required = declaredVar?.required ?: true,
                description = declaredVar?.description,
            )
        }

        return result
    }

    private fun parseEnvFile(
        content: String,
        out: MutableMap<String, RequiredEnvironmentVariable>,
    ) {
        var lastComment: String? = null
        for (rawLine in content.lineSequence()) {
            val line = rawLine.trim()
            if (line.startsWith("#")) {
                lastComment = line.removePrefix("#").trim().removePrefix(":")
                    .removePrefix(" ").trim()
                continue
            }
            if (line.isEmpty()) {
                lastComment = null
                continue
            }
            val match = ENV_NAME.matchEntire(line) ?: continue
            val name = match.groupValues[1]
            val optional = lastComment?.contains("optional", ignoreCase = true) == true
            out[name] = RequiredEnvironmentVariable(
                name = name,
                required = !optional,
                description = lastComment?.takeIf { it.isNotBlank() },
            )
            lastComment = null
        }
    }

    private fun scanSources(context: RepositoryContext, consumer: (String) -> Unit) {
        var scanned = 0
        try {
            Files.walk(context.root, 8).use { stream ->
                stream.forEach { path ->
                    if (scanned >= MAX_SCANNED_FILES) return@forEach
                    if (!Files.isRegularFile(path)) return@forEach
                    val relative = context.root.relativize(path)
                    for (segment in relative) {
                        val name = segment.toString()
                        if (name == "node_modules" || name == ".git" || name == ".venv" ||
                            name == "venv" || name == "build" || name == "dist"
                        ) {
                            return@forEach
                        }
                    }
                    val name = path.fileName?.toString() ?: return@forEach
                    if (name.endsWith(".js") || name.endsWith(".ts") || name.endsWith(".mts") ||
                        name.endsWith(".py") || name.endsWith(".kt") || name.endsWith(".java") ||
                        name.endsWith(".jsx") || name.endsWith(".tsx")
                    ) {
                        runCatching {
                            val content = Files.readString(path, java.nio.charset.StandardCharsets.UTF_8)
                            scanned += 1
                            consumer(content)
                        }
                    }
                }
            }
        } catch (_: Exception) {
            // Walk failed halfway — return whatever we collected.
        }
    }
}