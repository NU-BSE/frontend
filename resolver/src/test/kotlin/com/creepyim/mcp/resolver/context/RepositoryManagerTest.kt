package com.creepyim.mcp.resolver.context

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.nio.file.Path

class RepositoryManagerTest {

    private val manager = RepositoryManager(Path.of("/tmp/creepyim-mcp-resolver-test-cache"))

    @Test
    fun `windows drive path maps to a wsl mount on posix hosts`() {
        if (System.getProperty("os.name").startsWith("Windows")) return

        val mapped = manager.normalizeLocalPath(Path.of("C:\\development\\my-mcp\\server"))

        assertEquals("/mnt/c/development/my-mcp/server", mapped.toString())
    }

    @Test
    fun `posix paths pass through unchanged`() {
        if (!System.getProperty("os.name").startsWith("Windows")) {
            val mapped = manager.normalizeLocalPath(Path.of("/home/user/mcp"))
            assertEquals("/home/user/mcp", mapped.toString())
        }
    }

    @Test
    fun `materialize accepts an existing local directory`() {
        val dir = TestRepoUtil.create()
        val context = manager.materialize(com.creepyim.mcp.resolver.model.McpSource.LocalDirectory(dir))

        assertEquals(dir.toAbsolutePath().normalize(), context.root.toAbsolutePath().normalize())
        assertTrue(context.listFiles().isNotEmpty())
    }

    @Test
    fun `materialize rejects a missing local directory`() {
        val missing = Path.of("/definitely/does/not/exist/xyz")
        val error = org.junit.jupiter.api.Assertions.assertThrows(
            com.creepyim.mcp.resolver.exception.McpResolutionException.UnsupportedRepository::class.java,
        ) {
            manager.materialize(com.creepyim.mcp.resolver.model.McpSource.LocalDirectory(missing))
        }
        assertTrue(error.message!!.contains("does not exist"))
    }

    private object TestRepoUtil {
        fun create(): Path {
            val dir = java.nio.file.Files.createTempDirectory("repo-manager-test")
            java.nio.file.Files.writeString(dir.resolve("package.json"), """{ "name": "x" }""")
            return dir
        }
    }
}