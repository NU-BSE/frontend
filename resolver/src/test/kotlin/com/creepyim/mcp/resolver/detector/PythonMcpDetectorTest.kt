package com.creepyim.mcp.resolver.detector

import com.creepyim.mcp.resolver.TestRepo
import com.creepyim.mcp.resolver.model.McpRuntime
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class PythonMcpDetectorTest {

    private val detector = PythonMcpDetector()

    @Test
    fun `pyproject project scripts resolves uv run in a uv project`() {
        val context = TestRepo.create(
            mapOf(
                "pyproject.toml" to """
                    [project]
                    name = "example-mcp"
                    version = "0.1.0"

                    [project.scripts]
                    example-mcp = "example_mcp.server:main"

                    [tool.uv]
                """.trimIndent(),
                "uv.lock" to "",
            ),
        )

        val result = detector.detect(context)

        assertNotNull(result)
        assertEquals(McpRuntime.PYTHON, result!!.runtime)
        val best = result.candidates.minByOrNull { it.priority }
        assertEquals("uv", best?.command)
        assertEquals(listOf("run", "example-mcp"), best?.args)
    }

    @Test
    fun `pyproject project scripts falls back to python module in a plain project`() {
        val context = TestRepo.create(
            mapOf(
                "pyproject.toml" to """
                    [project]
                    name = "plain-mcp"
                    version = "0.1.0"

                    [project.scripts]
                    plain-mcp = "plain_mcp.server:main"
                """.trimIndent(),
            ),
        )

        val result = detector.detect(context)

        assertNotNull(result)
        val best = result!!.candidates.minByOrNull { it.priority }
        assertEquals("python", best?.command)
        assertEquals(listOf("-m", "plain-mcp"), best?.args)
    }

    @Test
    fun `module entrypoint resolves python -m module`() {
        val context = TestRepo.create(
            mapOf(
                "pyproject.toml" to """
                    [project]
                    name = "module-mcp"
                """.trimIndent(),
                "module_mcp/__main__.py" to "from .server import main\nmain()",
            ),
        )

        val result = detector.detect(context)

        assertNotNull(result)
        val best = result!!.candidates.minByOrNull { it.priority }
        assertEquals("python", best?.command)
        assertEquals(listOf("-m", "module_mcp"), best?.args)
    }

    @Test
    fun `poetry project resolves poetry run`() {
        val context = TestRepo.create(
            mapOf(
                "pyproject.toml" to """
                    [tool.poetry.scripts]
                    poetry-mcp = "poetry_mcp.server:main"
                """.trimIndent(),
                "poetry.lock" to "",
            ),
        )

        val result = detector.detect(context)

        assertNotNull(result)
        val best = result!!.candidates.minByOrNull { it.priority }
        assertEquals("poetry", best?.command)
    }

    @Test
    fun `project without python manifest is not detected`() {
        val context = TestRepo.create(mapOf("requirements.txt" to ""))
        assertNotNull(detector.detect(context))
    }

    @Test
    fun `project without any python files is not detected`() {
        val context = TestRepo.create(mapOf("index.js" to "// nope"))
        assertNull(detector.detect(context))
    }
}