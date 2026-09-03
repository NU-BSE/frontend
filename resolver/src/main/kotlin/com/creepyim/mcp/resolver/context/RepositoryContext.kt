package com.creepyim.mcp.resolver.context

import com.creepyim.mcp.resolver.model.McpSource
import java.nio.file.Files
import java.nio.file.Path
import java.util.stream.Collectors

/**
 * Immutable view of the repository being inspected. All file access should go
 * through here so detectors stay independent of where the checkout lives.
 */
class RepositoryContext(
    val root: Path,
    val source: McpSource,
) {
    val isRemote: Boolean get() = source is McpSource.Repository

    fun exists(relative: String): Boolean {
        val child = root.resolve(relative).normalize()
        if (!child.startsWith(root)) return false
        return Files.isRegularFile(child) || Files.isDirectory(child)
    }

    fun file(relative: String): Path {
        val child = root.resolve(relative).normalize()
        if (!child.startsWith(root)) {
            throw IllegalArgumentException("Path escapes repository root: $relative")
        }
        return child
    }

    fun readText(relative: String): String? {
        val path = file(relative)
        if (!Files.isRegularFile(path)) return null
        return runCatching { Files.readString(path) }.getOrNull()
    }

    fun listFiles(): List<Path> =
        runCatching {
            Files.list(root).use { stream -> stream.collect(Collectors.toList()) }
        }.getOrDefault(emptyList())

    fun listFilesRecursive(relative: String, maxDepth: Int = 8): List<Path> =
        runCatching {
            Files.walk(file(relative), maxDepth).use { stream ->
                stream.collect(Collectors.toList())
            }
        }.getOrDefault(emptyList())
}