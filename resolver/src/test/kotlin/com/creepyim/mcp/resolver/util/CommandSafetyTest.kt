package com.creepyim.mcp.resolver.util

import com.creepyim.mcp.resolver.TestRepo
import com.creepyim.mcp.resolver.validate.McpStartupValidator
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class CommandSafetyTest {

    @Test
    fun `rejects shell metacharacters`() {
        assertFalse(CommandSafety.validateCommand("sh -c 'x'", null))
        assertFalse(CommandSafety.validateCommand("npx;rm", null))
        assertFalse(CommandSafety.validateCommand("a && b", null))
        assertFalse(CommandSafety.validateCommand("`ls`", null))
        assertFalse(CommandSafety.validateCommand("$(x)", null))
        assertFalse(CommandSafety.validateCommand("x > out", null))
    }

    @Test
    fun `accepts plain executable names`() {
        assertTrue(CommandSafety.validateCommand("node", null))
        assertTrue(CommandSafety.validateCommand("npx", null))
        assertTrue(CommandSafety.validateCommand("uv", null))
        assertTrue(CommandSafety.validateCommand("/usr/bin/python", null))
    }

    @Test
    fun `rejects traversal commands`() {
        assertFalse(CommandSafety.validateCommand("../evil", null))
        assertFalse(CommandSafety.validateCommand("../../bin/sh", null))
    }

    @Test
    fun `accepts in-directory relative commands`() {
        assertTrue(CommandSafety.validateCommand("./gradlew", null))
        assertTrue(CommandSafety.validateCommand("./mvnw", null))
    }

    @Test
    fun `args are validated too`() {
        assertFalse(CommandSafety.validateArgs(listOf("a;b")))
        assertTrue(CommandSafety.validateArgs(listOf("dist/my server.js", "-y", "@org/pkg")))
    }

    @Test
    fun `readme parser extracts structured mcpServers config`() {
        val context = TestRepo.create(
            mapOf(
                "README.md" to """
                    ## Usage
                    ```json
                    {
                      "mcpServers": {
                        "my-server": {
                          "command": "uv",
                          "args": ["run", "my-server"]
                        }
                      }
                    }
                    ```
                """.trimIndent(),
            ),
        )

        val launch = ReadmeParser.find(context)

        assertEquals("uv", launch?.command)
        assertEquals(listOf("run", "my-server"), launch?.args)
    }

    @Test
    fun `readme parser ignores shell one-liners`() {
        val context = TestRepo.create(
            mapOf(
                "README.md" to """
                    Run with:
                    ```bash
                    npm install && node dist/index.js
                    ```
                """.trimIndent(),
            ),
        )

        assertEquals(null, ReadmeParser.find(context))
    }

    @Test
    fun `startup validator flags a missing absolute runtime`() {
        val context = TestRepo.create(
            mapOf("package.json" to """{ "name": "x", "bin": "index.js" }""", "index.js" to ""),
        )
        val resolved = com.creepyim.mcp.resolver.resolver.DefaultMcpResolver().resolveContext(context)

        // An absolute path to a nonexistent runtime cannot be installed by the caller.
        val bogus = resolved.copy(command = "/definitely/missing/node-xyz-12345")
        val error = org.junit.jupiter.api.Assertions.assertThrows(
            com.creepyim.mcp.resolver.exception.McpResolutionException.RuntimeNotInstalled::class.java,
        ) {
            McpStartupValidator().validate(bogus, context)
        }
        assertTrue(error.message!!.contains("not found"))
    }
}