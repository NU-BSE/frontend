package com.creepyim.mcp.resolver.validate

import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.PosixFilePermission

/**
 * Resolves a launch command to an absolute path, looking it up on PATH (or in
 * the working directory for `./name` commands) without executing anything.
 */
object CommandAvailability {

    fun resolve(command: String, workingDirectory: Path?): Path? {
        // Absolute path.
        if (command.startsWith("/")) {
            val candidate = Path.of(command)
            return if (isExecutable(candidate)) candidate else null
        }
        // Explicit relative command inside the working directory.
        if (command.startsWith("./") || command.startsWith("../")) {
            val base = workingDirectory ?: return null
            val candidate = base.resolve(command).normalize()
            return if (isExecutable(candidate)) candidate else null
        }
        // PATH lookup (order: own PATH first, then common runtime dirs).
        val home = System.getProperty("user.home") ?: "/root"
        val pathEnv = System.getenv("PATH") ?: ""
        val dirs = pathEnv.split(java.io.File.pathSeparator).filter { it.isNotBlank() } +
            listOf("/usr/local/bin", "/usr/bin", "/bin", "$home/.local/bin", "$home/.bun/bin")
        for (dir in dirs) {
            val candidate = Path.of(dir).resolve(command)
            if (isExecutable(candidate)) return candidate
        }
        return null
    }

    private fun isExecutable(path: Path): Boolean {
        if (!Files.isRegularFile(path)) return false
        return try {
            Files.isExecutable(path) ||
                Files.getPosixFilePermissions(path).contains(PosixFilePermission.OWNER_EXECUTE)
        } catch (_: UnsupportedOperationException) {
            Files.isExecutable(path)
        } catch (_: Exception) {
            true // Windows-style environment without POSIX metadata
        }
    }
}