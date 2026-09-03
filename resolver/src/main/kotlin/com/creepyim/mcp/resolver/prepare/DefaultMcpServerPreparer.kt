package com.creepyim.mcp.resolver.prepare

import com.creepyim.mcp.resolver.context.RepositoryContext
import com.creepyim.mcp.resolver.exception.McpResolutionException
import com.creepyim.mcp.resolver.model.McpRuntime
import com.creepyim.mcp.resolver.model.ResolvedMcp
import com.creepyim.mcp.resolver.util.Json
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path

/**
 * Runtime-aware preparation:
 *
 * - Node.js: install dependencies (npm ci when a lockfile exists, else npm
 *   install) and run `npm run build` when the chosen entrypoint has not been
 *   built yet.
 * - Python: `uv sync` for uv projects, `poetry install` for poetry projects.
 * - JVM: dev tasks resolve dependencies themselves; no separate step.
 *
 * Commands are fixed, known-safe invocations — never text from the repository.
 */
class DefaultMcpServerPreparer : McpServerPreparer {

    private data class Command(val command: String, val args: List<String>)

    override fun prepare(resolved: ResolvedMcp, context: RepositoryContext) {
        if (!resolved.requiresPreparation) return
        val commands = buildCommands(resolved, context)
        for (cmd in commands) {
            exec(cmd.command, cmd.args, resolved.workingDirectory ?: context.root)
        }
    }

    private fun buildCommands(resolved: ResolvedMcp, context: RepositoryContext): List<Command> {
        return when (resolved.runtime) {
            McpRuntime.NODE -> nodeCommands(resolved, context)
            McpRuntime.PYTHON -> pythonCommands(context)
            else -> emptyList()
        }
    }

    private fun nodeCommands(resolved: ResolvedMcp, context: RepositoryContext): List<Command> {
        val commands = mutableListOf<Command>()
        val hasLockfile = listOf("package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock")
            .any { context.exists(it) }

        // Prefer the package manager implied by the lockfile.
        val (installCmd, installArgs) = when {
            context.exists("pnpm-lock.yaml") -> "pnpm" to listOf("install", "--frozen-lockfile")
            context.exists("yarn.lock") -> "yarn" to listOf("install", "--frozen-lockfile")
            context.exists("bun.lock") || context.exists("bun.lockb") -> "bun" to listOf("install")
            hasLockfile -> "npm" to listOf("ci")
            else -> "npm" to listOf("install")
        }
        commands += Command(installCmd, installArgs)

        // Build only when the target entrypoint is missing but a build script
        // exists (checked from the repo's own package.json — a safe, known
        // script name, invoked through npm, not through a shell).
        val packageJson = context.readText("package.json")?.let { Json.parse(it) }
        val buildScript = packageJson?.let { Json.text(Json.obj(it, "scripts"), "build") }
        val entrypointMissing = resolved.args.firstOrNull()?.let { !context.exists(it) } ?: false
        if (buildScript != null && entrypointMissing) {
            commands += Command("npm", listOf("run", "build"))
        }
        return commands
    }

    private fun pythonCommands(context: RepositoryContext): List<Command> {
        return when {
            context.exists("uv.lock") || context.exists("pyproject.toml") && hasToolUv(context) ->
                listOf(Command("uv", listOf("sync")))
            context.exists("poetry.lock") -> listOf(Command("poetry", listOf("install")))
            else -> emptyList()
        }
    }

    private fun hasToolUv(context: RepositoryContext): Boolean {
        val text = context.readText("pyproject.toml") ?: return false
        return text.contains("[tool.uv]")
    }

    private fun exec(command: String, args: List<String>, workingDir: Path) {
        val process = ProcessBuilder(listOf(command) + args)
            .directory(workingDir.toFile())
            .redirectErrorStream(false)
            .start()
        val stderr = process.errorStream.readBytes().toString(StandardCharsets.UTF_8)
        val exit = process.waitFor()
        if (exit != 0) {
            throw McpResolutionException.PreparationFailed(
                "Preparation command '$command ${args.joinToString(" ")}' failed with exit code $exit" +
                    (if (stderr.isNotBlank()) ": ${stderr.takeLast(400)}" else ""),
            )
        }
    }
}