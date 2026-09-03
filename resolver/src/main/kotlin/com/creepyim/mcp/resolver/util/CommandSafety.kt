package com.creepyim.mcp.resolver.util

import java.nio.file.Path

/**
 * Structural validation for launch commands and arguments.
 *
 * A repository is untrusted: nothing it contains may ever be assembled into a
 * shell string. `command` must be a plain executable name or absolute path and
 * `args` must be a plain list. Any value that would require a shell to
 * interpret (metacharacters, pipes, redirection, substitution) is rejected.
 */
object CommandSafety {

    private val SHELL_METACHARACTERS = Regex("[;&|`\\$<>(){}!\\n\\r]")

    fun validateCommand(command: String, path: Path?): Boolean {
        if (command.isBlank() || command.length > 1024) return false
        if (SHELL_METACHARACTERS.containsMatchIn(command)) return false
        // A command is a single token — no spaces, no quoting, no substitution.
        if (command.any { it.isWhitespace() }) return false
        if (command.contains('\'') || command.contains('"')) return false
        if (command.startsWith("..")) return false
        if (command.contains('/')) {
            // Relative paths are only allowed as explicit ./<name> (never bare
            // traversal); otherwise the command must be absolute.
            if (!command.startsWith("./") && !Path.of(command).isAbsolute) return false
        }
        return true
    }

    fun validateArgs(args: List<String>): Boolean {
        if (args.size > 128) return false
        return args.none { arg ->
            arg.isEmpty() || arg.length > 4096 || SHELL_METACHARACTERS.containsMatchIn(arg)
        }
    }

    fun validateWorkingDirectory(dir: Path?, root: Path?): Boolean {
        if (dir == null) return true
        val normalized = dir.toAbsolutePath().normalize()
        if (!java.nio.file.Files.isDirectory(normalized)) return false
        if (root != null && !normalized.startsWith(root.toAbsolutePath().normalize())) return false
        return true
    }
}