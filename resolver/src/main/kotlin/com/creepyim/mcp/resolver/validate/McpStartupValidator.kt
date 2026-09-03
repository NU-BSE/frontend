package com.creepyim.mcp.resolver.validate

import com.creepyim.mcp.resolver.context.RepositoryContext
import com.creepyim.mcp.resolver.exception.McpResolutionException
import com.creepyim.mcp.resolver.model.ResolvedMcp
import com.creepyim.mcp.resolver.util.CommandSafety
import java.nio.file.Files

/**
 * Static startup validation. This never starts the server — it verifies that
 * the resolved launch is structurally sound and the required executables and
 * files exist. The authoritative runtime check (real MCP `initialize` +
 * `tools/list`) is performed by the framework adapter with the official MCP
 * client.
 */
class McpStartupValidator {

    fun validate(resolved: ResolvedMcp, context: RepositoryContext) {
        if (!CommandSafety.validateCommand(resolved.command, context.root)) {
            throw McpResolutionException.InvalidCommand(
                "Command '${resolved.command}' is not a safe, well-formed executable name.",
            )
        }
        if (!CommandSafety.validateArgs(resolved.args)) {
            throw McpResolutionException.InvalidCommand(
                "Arguments for '${resolved.command}' are not safe to pass to a process.",
            )
        }
        if (resolved.workingDirectory != null &&
            !CommandSafety.validateWorkingDirectory(resolved.workingDirectory, context.root)
        ) {
            throw McpResolutionException.StartupProbeFailed(
                "Working directory ${resolved.workingDirectory} is invalid.",
            )
        }

        val executable = CommandAvailability.resolve(resolved.command, resolved.workingDirectory)
        if (executable == null) {
            // Absolute-path commands must resolve on this host. Bare command
            // names (node, python, npx, ...) may live in the caller's PATH —
            // the framework adapter verifies them in the actual spawn
            // environment before starting the process.
            if (resolved.command.startsWith("/")) {
                throw McpResolutionException.RuntimeNotInstalled(
                    resolved.runtime,
                    resolved.command,
                    hint = "Install the runtime or add it to PATH, or supply a ResolvedMcp with an absolute command.",
                )
            }
        }

        // If the first argument is a relative file path, it should exist.
        resolved.args.firstOrNull()?.let { firstArg ->
            if (firstArg.endsWith(".js") || firstArg.endsWith(".jar") || firstArg.endsWith(".py") || firstArg.endsWith(".mjs") || firstArg.endsWith(".cjs")) {
                val base = resolved.workingDirectory ?: context.root
                val file = base.resolve(firstArg).normalize()
                if (!Files.isRegularFile(file)) {
                    throw McpResolutionException.EntrypointNotFound(
                        resolved.runtime,
                        "Entrypoint '$firstArg' does not exist. Run preparation (install/build) first.",
                    )
                }
            }
        }
    }
}