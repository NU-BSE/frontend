package com.creepyim.mcp.resolver.resolver

import com.creepyim.mcp.resolver.TestRepo
import com.creepyim.mcp.resolver.exception.McpResolutionException
import com.creepyim.mcp.resolver.model.McpSource
import com.creepyim.mcp.resolver.model.McpRuntime
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.nio.file.Files

class DefaultMcpResolverTest {

    private val resolver = DefaultMcpResolver()

    @Test
    fun `unknown repository throws NoDetectorMatched`() {
        val context = TestRepo.create(mapOf("random.txt" to "nothing here"))
        val error = assertThrows(McpResolutionException.NoDetectorMatched::class.java) {
            resolver.resolveContext(context)
        }
        assertTrue(error.reasons.isNotEmpty())
    }

    @Test
    fun `multiple detectors pick the higher confidence result`() {
        // Node project with a README MCP config AND a stray pyproject.toml.
        val context = TestRepo.create(
            mapOf(
                "package.json" to """
                    {
                      "name": "multi-mcp",
                      "bin": "dist/index.js",
                      "dependencies": { "@modelcontextprotocol/server": "^2.0.0" }
                    }
                """.trimIndent(),
                "dist/index.js" to "// built",
                "README.md" to """
                    ```json
                    { "mcpServers": { "x": { "command": "npx", "args": ["-y", "multi-mcp"] } } }
                    ```
                """.trimIndent(),
                "pyproject.toml" to "[project]\nname = \"multi-mcp\"\n",
            ),
        )

        val resolved = resolver.resolveContext(context)

        assertEquals(McpRuntime.NODE, resolved.runtime)
        assertEquals("npx", resolved.command)
    }

    @Test
    fun `local directory source resolves in place`() {
        val dir = TestRepo.dir()
        TestRepo.withFiles(
            dir,
            mapOf(
                "package.json" to """{ "name": "local-mcp", "bin": "index.js" }""",
                "index.js" to "// server",
            ),
        )

        val resolved = resolver.resolve(McpSource.LocalDirectory(dir))

        assertEquals("node", resolved.command)
        assertEquals(listOf("index.js"), resolved.args)
    }

    @Test
    fun `required environment variables are detected from source`() {
        val context = TestRepo.create(
            mapOf(
                "package.json" to """{ "name": "env-mcp", "bin": "index.js" }""",
                "index.js" to "const t = process.env.GITHUB_TOKEN; const d = process.env.DATABASE_URL;",
                ".env.example" to "GITHUB_TOKEN=your-token\n# optional\nDEBUG=false\n",
            ),
        )

        val resolved = resolver.resolveContext(context)

        val names = resolved.requiredEnvironmentVariables.map { it.name }
        assertTrue("GITHUB_TOKEN" in names, "expected GITHUB_TOKEN in $names")
        assertTrue("DATABASE_URL" in names, "expected DATABASE_URL in $names")
        val debug = resolved.requiredEnvironmentVariables.firstOrNull { it.name == "DEBUG" }
        assertEquals(false, debug?.required)
    }

    @Test
    fun `invalid command from readme is rejected with InvalidCommand`() {
        val context = TestRepo.create(
            mapOf(
                "package.json" to """{ "name": "bad-mcp", "bin": "index.js" }""",
                "index.js" to "// server",
                "README.md" to """```json
                    { "mcpServers": { "x": { "command": "sh -c 'rm -rf /'", "args": [] } } }
                    ```""".trimIndent(),
            ),
        )

        // The README candidate is unsafe, so the resolver falls back to the bin.
        val resolved = resolver.resolveContext(context)
        assertEquals("node", resolved.command)
    }

    @Test
    fun `path with spaces is preserved as a single argument`() {
        val context = TestRepo.create(
            mapOf(
                "package.json" to """{ "name": "space-mcp", "bin": "dist/my server.js" }""",
            ),
        )

        val resolved = resolver.resolveContext(context)
        assertEquals(listOf("dist/my server.js"), resolved.args)
    }

    @Test
    fun `working directory is set for in-repo commands`() {
        val dir = TestRepo.dir()
        TestRepo.withFiles(
            dir,
            mapOf(
                "package.json" to """{ "name": "cwd-mcp", "bin": "index.js" }""",
                "index.js" to "// server",
            ),
        )

        val resolved = resolver.resolve(McpSource.LocalDirectory(dir))
        assertEquals(dir.toAbsolutePath().normalize(), resolved.workingDirectory?.toAbsolutePath()?.normalize())
    }
}