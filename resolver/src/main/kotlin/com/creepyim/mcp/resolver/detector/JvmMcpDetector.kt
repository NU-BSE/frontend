package com.creepyim.mcp.resolver.detector

import com.creepyim.mcp.resolver.context.RepositoryContext
import com.creepyim.mcp.resolver.model.McpRuntime
import com.creepyim.mcp.resolver.util.ReadmeParser
import java.nio.file.Files
import java.nio.file.Path

/**
 * Detects JVM (Kotlin/Java) MCP server projects.
 *
 * Production-like preference: a prebuilt runnable artifact (`java -jar`)
 * beats a development task (`./gradlew run`).
 *
 * Evidence order:
 *   1. explicit MCP config (README `mcpServers` JSON);
 *   2. runnable artifact (build/libs, target);
 *   3. Gradle application plugin / mainClass;
 *   4. Maven exec / Spring Boot plugin;
 *   5. heuristics.
 */
class JvmMcpDetector : McpProjectDetector {

    override val runtime: McpRuntime = McpRuntime.JVM

    override fun detect(context: RepositoryContext): DetectionResult? {
        val hasGradle = context.exists("build.gradle") || context.exists("build.gradle.kts")
        val hasPom = context.exists("pom.xml")
        val hasGradlew = context.exists("gradlew")
        val hasMvnw = context.exists("mvnw")

        if (!hasGradle && !hasPom) return null

        val evidence = mutableListOf<String>()
        var confidence = 0.2

        if (hasGradle) evidence += "gradle build (${if (context.exists("build.gradle.kts")) "kts" else "groovy"})"
        if (hasPom) evidence += "maven pom.xml"

        val gradle = context.readText(if (context.exists("build.gradle.kts")) "build.gradle.kts" else "build.gradle")
        val pom = context.readText("pom.xml")

        val hasMcpDependency = gradleMcpDependency(gradle) || pomMcpDependency(pom)
        if (hasMcpDependency) {
            confidence += 0.15
            evidence += "JVM MCP SDK dependency"
        }

        val candidates = mutableListOf<LaunchCandidate>()

        // 1. Explicit MCP config in the README.
        ReadmeParser.find(context)?.let { readme ->
            confidence = (confidence + 0.35).coerceAtMost(1.0)
            evidence += "README MCP config: ${readme.command} ${readme.args.joinToString(" ")}"
            candidates += LaunchCandidate(
                command = readme.command,
                args = readme.args,
                workingDirectory = context.root,
                priority = 1,
                description = "command documented in ${readme.sourceFile}",
            )
        }

        // 2. Prebuilt runnable artifact.
        findRunnableJar(context)?.let { jar ->
            confidence = (confidence + 0.35).coerceAtMost(1.0)
            evidence += "runnable artifact: $jar"
            candidates += LaunchCandidate(
                command = "java",
                args = listOf("-jar", jar),
                workingDirectory = context.root,
                priority = 2,
                description = "runnable jar $jar",
            )
        }

        // 3. Gradle application plugin.
        val mainClass = extractGradleMainClass(gradle)
        if (mainClass != null) {
            confidence = (confidence + 0.2).coerceAtMost(1.0)
            evidence += "gradle application mainClass: $mainClass"
            candidates += LaunchCandidate(
                command = if (hasGradlew) "./gradlew" else "gradle",
                args = listOf("run"),
                workingDirectory = context.root,
                priority = 3,
                requiresPreparation = true,
                description = "gradle application run task (mainClass $mainClass)",
            )
        }

        // 4. Maven runnable project.
        val mavenRun = extractMavenRun(pom)
        if (mavenRun != null) {
            evidence += mavenRun.second
            candidates += LaunchCandidate(
                command = if (hasMvnw) "./mvnw" else "mvn",
                args = listOf(mavenRun.first),
                workingDirectory = context.root,
                priority = 4,
                requiresPreparation = true,
                description = mavenRun.second,
            )
        }

        if (candidates.isEmpty()) {
            evidence += "JVM project but no launchable entrypoint found"
            return DetectionResult(runtime, confidence.coerceAtMost(1.0), evidence, emptyList())
        }

        return DetectionResult(
            runtime = runtime,
            confidence = confidence.coerceAtMost(1.0),
            evidence = evidence,
            candidates = candidates,
        )
    }

    private fun findRunnableJar(context: RepositoryContext): String? {
        val dirs = listOf("build/libs", "target")
        for (dir in dirs) {
            val path = context.file(dir)
            if (!Files.isDirectory(path)) continue
            val jars = Files.list(path).use { stream ->
                stream
                    .filter { Files.isRegularFile(it) && it.fileName.toString().endsWith(".jar") }
                    .map { it.fileName.toString() }
                    .toList()
            }.sortedWith(
                compareBy<String> { name ->
                    when {
                        name.contains("-sources") || name.contains("-javadoc") -> 2
                        name.contains("-plain") || name.contains("original-") -> 1
                        else -> 0
                    }
                }.thenByDescending { it.length },
            )
            val best = jars.firstOrNull { !it.contains("-sources") && !it.contains("-javadoc") }
            if (best != null) return "$dir/$best"
        }
        return null
    }

    private fun gradleMcpDependency(gradle: String?): Boolean {
        if (gradle == null) return false
        return Regex("""io\.modelcontextprotocol|modelcontextprotocol\.kotlin|spring-ai|spring\.ai|mcp\.sdk""", RegexOption.IGNORE_CASE)
            .containsMatchIn(gradle)
    }

    private fun pomMcpDependency(pom: String?): Boolean {
        if (pom == null) return false
        return Regex("""io\.modelcontextprotocol|modelcontextprotocol|spring-ai|spring\.ai""", RegexOption.IGNORE_CASE)
            .containsMatchIn(pom)
    }

    private fun extractGradleMainClass(gradle: String?): String? {
        if (gradle == null) return null
        // application plugin present?
        val hasApplicationPlugin = Regex(
            """id\s*[('"]application['")]\s*|apply\s+plugin\s*[:=]\s*['"]application['"]""",
            RegexOption.IGNORE_CASE,
        ).containsMatchIn(gradle)
        if (!hasApplicationPlugin) return null

        return Regex("""mainClass\s*(?:\.set\(|\s*=\s*)[("']?([A-Za-z0-9_.]+)['")]?""")
            .find(gradle)?.groupValues?.get(1)
            ?: Regex("""mainClassName\s*[=:]\s*['"]([A-Za-z0-9_.]+)['"]""")
                .find(gradle)?.groupValues?.get(1)
    }

    /** Returns (maven goal, evidence description) or null. */
    private fun extractMavenRun(pom: String?): Pair<String, String>? {
        if (pom == null) return null
        val hasExec = Regex("""exec-maven-plugin""").containsMatchIn(pom)
        val hasSpringBoot = Regex("""spring-boot-maven-plugin""").containsMatchIn(pom)
        return when {
            hasExec -> "exec:java" to "maven exec-maven-plugin"
            hasSpringBoot -> "spring-boot:run" to "maven spring-boot-maven-plugin"
            else -> null
        }
    }
}