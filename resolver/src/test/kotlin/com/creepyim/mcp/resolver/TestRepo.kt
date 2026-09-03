package com.creepyim.mcp.resolver

import com.creepyim.mcp.resolver.context.RepositoryContext
import com.creepyim.mcp.resolver.model.McpSource
import java.nio.file.Files
import java.nio.file.Path

/**
 * Builds throwaway fixture repositories on disk for detector tests.
 */
object TestRepo {
    fun create(files: Map<String, String>): RepositoryContext {
        val dir = Files.createTempDirectory("mcp-resolver-test")
        for ((relative, content) in files) {
            val path = dir.resolve(relative)
            Files.createDirectories(path.parent)
            Files.writeString(path, content)
        }
        return RepositoryContext(dir, McpSource.LocalDirectory(dir))
    }

    fun dir(): Path = Files.createTempDirectory("mcp-resolver-test")

    fun withFiles(root: Path, files: Map<String, String>) {
        for ((relative, content) in files) {
            val path = root.resolve(relative)
            Files.createDirectories(path.parent)
            Files.writeString(path, content)
        }
    }
}