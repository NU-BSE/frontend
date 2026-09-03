package com.creepyim.mcp.resolver.detector

import com.creepyim.mcp.resolver.TestRepo
import com.creepyim.mcp.resolver.model.McpRuntime
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class NodeMcpDetectorTest {

    private val detector = NodeMcpDetector()

    @Test
    fun `package json with bin resolves node entrypoint`() {
        val context = TestRepo.create(
            mapOf(
                "package.json" to """
                    {
                      "name": "example-mcp-server",
                      "version": "1.0.0",
                      "bin": {
                        "mcp-server-example": "dist/index.js"
                      },
                      "dependencies": {
                        "@modelcontextprotocol/server": "^2.0.0"
                      }
                    }
                """.trimIndent(),
                "dist/index.js" to "// server",
            ),
        )

        val result = detector.detect(context)

        assertNotNull(result)
        assertEquals(McpRuntime.NODE, result!!.runtime)
        assertTrue(result.confidence > 0.5)
        val best = result.candidates.minByOrNull { it.priority }
        assertEquals("node", best?.command)
        assertEquals(listOf("dist/index.js"), best?.args)
    }

    @Test
    fun `string bin field is used directly`() {
        val context = TestRepo.create(
            mapOf(
                "package.json" to """
                    {
                      "name": "mcp-simple",
                      "bin": "index.js"
                    }
                """.trimIndent(),
                "index.js" to "// server",
            ),
        )

        val result = detector.detect(context)

        assertNotNull(result)
        val best = result!!.candidates.minByOrNull { it.priority }
        assertEquals(listOf("index.js"), best?.args)
    }

    @Test
    fun `npm script is used when no bin or main`() {
        val context = TestRepo.create(
            mapOf(
                "package.json" to """
                    {
                      "name": "script-based-mcp",
                      "scripts": {
                        "mcp": "node build/run.js"
                      }
                    }
                """.trimIndent(),
            ),
        )

        val result = detector.detect(context)

        assertNotNull(result)
        val best = result!!.candidates.minByOrNull { it.priority }
        assertEquals("npm", best?.command)
        assertEquals(listOf("run", "mcp"), best?.args)
    }

    @Test
    fun `typescript dist entrypoint heuristic when metadata is absent`() {
        val context = TestRepo.create(
            mapOf(
                "package.json" to """{ "name": "ts-mcp", "private": true }""".trimIndent(),
                "dist/index.js" to "// built",
            ),
        )

        val result = detector.detect(context)

        assertNotNull(result)
        val best = result!!.candidates.minByOrNull { it.priority }
        assertEquals(listOf("dist/index.js"), best?.args)
    }

    @Test
    fun `readme mcpServers config is the strongest evidence`() {
        val context = TestRepo.create(
            mapOf(
                "package.json" to """{ "name": "readme-mcp", "bin": "dist/index.js" }""".trimIndent(),
                "README.md" to """
                    # Server
                    ```json
                    {
                      "mcpServers": {
                        "example": {
                          "command": "npx",
                          "args": ["-y", "@example/mcp-server"]
                        }
                      }
                    }
                    ```
                """.trimIndent(),
            ),
        )

        val result = detector.detect(context)

        assertNotNull(result)
        val best = result!!.candidates.minByOrNull { it.priority }
        assertEquals("npx", best?.command)
        assertEquals(listOf("-y", "@example/mcp-server"), best?.args)
    }

    @Test
    fun `npx published package candidate is offered alongside node bin`() {
        val context = TestRepo.create(
            mapOf(
                "package.json" to """
                    {
                      "name": "@org/published-mcp",
                      "version": "1.0.0",
                      "bin": { "published-mcp": "dist/index.js" }
                    }
                """.trimIndent(),
                "dist/index.js" to "// built",
            ),
        )

        val result = detector.detect(context)

        assertNotNull(result)
        val commands = result!!.candidates.map { "${it.command} ${it.args.joinToString(" ")}" }
        assertTrue(commands.any { it == "npx -y @org/published-mcp" })
    }

    @Test
    fun `project without package json is not detected`() {
        val context = TestRepo.create(mapOf("index.js" to "// server"))
        assertNull(detector.detect(context))
    }

    @Test
    fun `node project without launchable entrypoint yields no candidates`() {
        val context = TestRepo.create(mapOf("package.json" to """{ "name": "empty" }"""))
        val result = detector.detect(context)
        assertNotNull(result)
        assertTrue(result!!.candidates.isEmpty())
    }
}