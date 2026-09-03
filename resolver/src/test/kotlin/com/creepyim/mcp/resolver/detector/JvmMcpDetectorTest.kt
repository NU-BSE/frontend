package com.creepyim.mcp.resolver.detector

import com.creepyim.mcp.resolver.TestRepo
import com.creepyim.mcp.resolver.model.McpRuntime
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import java.nio.file.Files

class JvmMcpDetectorTest {

    private val detector = JvmMcpDetector()

    @Test
    fun `gradle application plugin resolves gradlew run`() {
        val context = TestRepo.create(
            mapOf(
                "build.gradle" to """
                    plugins {
                        id 'application'
                    }
                    application {
                        mainClass = 'com.example.McpServerKt'
                    }
                """.trimIndent(),
                "gradlew" to "#!/bin/sh\nexec gradle \"\$@\"",
            ),
        )
        context.file("gradlew").toFile().setExecutable(true)

        val result = detector.detect(context)

        assertNotNull(result)
        assertEquals(McpRuntime.JVM, result!!.runtime)
        val best = result.candidates.minByOrNull { it.priority }
        assertEquals("./gradlew", best?.command)
        assertEquals(listOf("run"), best?.args)
    }

    @Test
    fun `runnable jar is preferred over dev task`() {
        val jar = TestRepo.dir()
        TestRepo.withFiles(
            jar,
            mapOf(
                "build.gradle" to """
                    plugins {
                        id 'application'
                    }
                    application {
                        mainClass = 'com.example.McpServerKt'
                    }
                """.trimIndent(),
            ),
        )
        Files.createDirectories(jar.resolve("build/libs"))
        Files.writeString(jar.resolve("build/libs/mcp-server-1.0.jar"), "PK\u0005\u0006")

        val context = com.creepyim.mcp.resolver.context.RepositoryContext(
            jar,
            com.creepyim.mcp.resolver.model.McpSource.LocalDirectory(jar),
        )
        val result = detector.detect(context)

        assertNotNull(result)
        val best = result!!.candidates.minByOrNull { it.priority }
        assertEquals("java", best?.command)
        assertEquals(listOf("-jar", "build/libs/mcp-server-1.0.jar"), best?.args)
    }

    @Test
    fun `maven spring boot project resolves mvnw spring-boot run`() {
        val context = TestRepo.create(
            mapOf(
                "pom.xml" to """
                    <project>
                      <artifactId>mcp-app</artifactId>
                      <build>
                        <plugins>
                          <plugin>
                            <artifactId>spring-boot-maven-plugin</artifactId>
                          </plugin>
                        </plugins>
                      </build>
                      <dependencies>
                        <dependency>
                          <artifactId>io.modelcontextprotocol.sdk</artifactId>
                        </dependency>
                      </dependencies>
                    </project>
                """.trimIndent(),
                "mvnw" to "#!/bin/sh\nexec mvn \"\$@\"",
            ),
        )
        context.file("mvnw").toFile().setExecutable(true)

        val result = detector.detect(context)

        assertNotNull(result)
        val best = result!!.candidates.minByOrNull { it.priority }
        assertEquals("./mvnw", best?.command)
        assertEquals(listOf("spring-boot:run"), best?.args)
    }

    @Test
    fun `non jvm project is not detected`() {
        val context = TestRepo.create(mapOf("package.json" to "{}"))
        assertNull(detector.detect(context))
    }
}