package com.creepyim.mcp.resolver.cli

import com.creepyim.mcp.resolver.context.RepositoryManager
import com.creepyim.mcp.resolver.exception.McpResolutionException
import com.creepyim.mcp.resolver.model.McpRuntime
import com.creepyim.mcp.resolver.model.McpSource
import com.creepyim.mcp.resolver.model.RequiredEnvironmentVariable
import com.creepyim.mcp.resolver.model.ResolvedMcp
import com.creepyim.mcp.resolver.prepare.DefaultMcpServerPreparer
import com.creepyim.mcp.resolver.resolver.DefaultMcpResolver
import com.creepyim.mcp.resolver.validate.McpStartupValidator
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ObjectNode
import java.nio.charset.StandardCharsets
import java.nio.file.Path
import kotlin.system.exitProcess

/**
 * JSON-stdio bridge so the resolver can be driven from non-JVM callers
 * (currently the TypeScript framework adapter).
 *
 * Protocol (mirrors the MCP stdio convention):
 *   stdout  = the JSON result / error envelope
 *   stderr  = human logs
 *
 * Usage:
 *   resolver-cli resolve '{"url":"https://github.com/x/y","ref":"main"}'
 *   resolver-cli resolve --prepare --validate '{"path":"/tmp/repo"}'
 *   resolver-cli resolve            # reads the source JSON from stdin
 *
 * Exit codes: 0 = success, 1 = resolution/preparation/validation failed,
 * 2 = usage error.
 */
class ResolverCli(
    private val resolver: DefaultMcpResolver = DefaultMcpResolver(),
    private val preparer: DefaultMcpServerPreparer = DefaultMcpServerPreparer(),
    private val validator: McpStartupValidator = McpStartupValidator(),
) {
    private val mapper = ObjectMapper()

    fun run(args: Array<String>) {
        val parsed = parseArgs(args.toList())
        val source = parsed.source
        val doPrepare = parsed.prepare
        val doValidate = parsed.validate

        try {
            val resolved = resolver.resolve(source)
            log("resolver selected: ${resolved.runtime}")
            log("resolved command: ${resolved.command} ${resolved.args.joinToString(" ")}")
            log("confidence: ${resolved.confidence}")
            for (evidence in resolved.evidence) log("evidence: $evidence")

            val context = RepositoryManager().materialize(source)

            if (doPrepare && resolved.requiresPreparation) {
                log("preparation started")
                preparer.prepare(resolved, context)
                log("preparation completed")
            }

            if (doValidate) {
                log("static validation started")
                validator.validate(resolved, context)
                log("static validation passed")
            }

            printOut(success(resolved))
            exitProcess(0)
        } catch (error: McpResolutionException) {
            printOut(failure(error))
            log("resolver failed: ${error.message}")
            exitProcess(1)
        } catch (error: Exception) {
            printOut(
                failure(
                    McpResolutionException.UnsupportedRepository(
                        "Unexpected error: ${error.message ?: error.javaClass.simpleName}",
                        error,
                    ),
                ),
            )
            exitProcess(1)
        }
    }

    private data class ParsedArgs(val source: McpSource, val prepare: Boolean, val validate: Boolean)

    private fun parseArgs(args: List<String>): ParsedArgs {
        var prepare = false
        var validate = false
        var sourceText: String? = null
        val positional = mutableListOf<String>()

        var i = 0
        while (i < args.size) {
            when (args[i]) {
                "--prepare" -> prepare = true
                "--validate" -> validate = true
                "--source" -> {
                    if (i + 1 >= args.size) usage()
                    sourceText = args[i + 1]
                    i += 1
                }
                else -> positional += args[i]
            }
            i += 1
        }

        if (positional.isNotEmpty() && positional[0] != "resolve") usage()

        if (sourceText == null) {
            sourceText = System.`in`.readBytes().toString(StandardCharsets.UTF_8).trim()
        }
        if (sourceText.isBlank()) usage()

        val source = parseSource(sourceText)
        return ParsedArgs(source, prepare, validate)
    }

    private fun parseSource(text: String): McpSource {
        val node = runCatching { mapper.readTree(text) }.getOrNull()
            ?: throw McpResolutionException.UnsupportedRepository("Invalid source JSON: $text")

        node.get("url")?.takeIf { it.isTextual }?.asText()?.let { url ->
            return McpSource.Repository(
                url = url,
                ref = node.get("ref")?.takeIf { it.isTextual }?.asText(),
            )
        }
        node.get("path")?.takeIf { it.isTextual }?.asText()?.let { path ->
            return McpSource.LocalDirectory(Path.of(path))
        }
        throw McpResolutionException.UnsupportedRepository(
            "Source must have a \"url\" or a \"path\" field.",
        )
    }

    private fun success(resolved: ResolvedMcp): ObjectNode {
        val node = mapper.createObjectNode()
        node.put("command", resolved.command)
        val args = node.putArray("args")
        resolved.args.forEach { args.add(it) }

        val env = node.putObject("environment")
        resolved.environment.forEach { (k, v) -> env.put(k, v) }

        node.put("workingDirectory", resolved.workingDirectory?.toString())
        val envNode = node.putArray("requiredEnvironmentVariables")
        resolved.requiredEnvironmentVariables.forEach { v -> envNode.add(envVar(v)) }

        node.put("runtime", resolved.runtime.name)
        node.put("confidence", resolved.confidence)
        val evidence = node.putArray("evidence")
        resolved.evidence.forEach { evidence.add(it) }
        node.put("requiresPreparation", resolved.requiresPreparation)
        node.put("launchDescription", resolved.launchDescription)
        return node
    }

    private fun envVar(v: RequiredEnvironmentVariable): JsonNode {
        val node = mapper.createObjectNode()
        node.put("name", v.name)
        node.put("required", v.required)
        v.description?.let { node.put("description", it) }
        return node
    }

    private fun failure(error: McpResolutionException): ObjectNode {
        val node = mapper.createObjectNode()
        val err = node.putObject("error")
        err.put("type", error.javaClass.simpleName.removeSuffix("Exception"))
        err.put("message", error.message ?: error.javaClass.simpleName)
        val hints = err.putArray("hints")
        when (error) {
            is McpResolutionException.MissingEnvironment -> {
                hints.add("Provide a value for ${error.variable} in the environment supplied to the framework adapter.")
                error.description?.let { hints.add(it) }
            }
            is McpResolutionException.RuntimeNotInstalled -> {
                hints.add("Install the ${error.runtime.name} runtime and ensure '${error.command}' is on PATH.")
            }
            is McpResolutionException.PreparationFailed -> {
                hints.add("Run the preparation step manually in the repository directory and retry.")
            }
            is McpResolutionException.RepositoryFetchFailed -> {
                hints.add("Verify the repository URL/ref and network access.")
            }
            else -> hints.add("Run 'npm run verify:resolver' for diagnostics.")
        }
        return node
    }

    private fun log(message: String) {
        System.err.println("[resolver] $message")
    }

    private fun printOut(node: ObjectNode) {
        System.out.println(mapper.writeValueAsString(node))
    }

    private fun usage(): Nothing {
        System.err.println(
            """
            usage: resolver-cli resolve [--prepare] [--validate] [--source <json>]
              --source <json>  {'url': '...', 'ref'?: '...'} | {'path': '...'}
              (or pipe the source JSON on stdin)
            """.trimIndent(),
        )
        exitProcess(2)
    }
}

fun main(args: Array<String>) {
    ResolverCli().run(args)
}