package com.creepyim.mcp.resolver.exception

import com.creepyim.mcp.resolver.model.McpRuntime

/**
 * Structured, actionable resolution failures. Messages state what failed, what
 * was detected, what command was attempted and what the user can do — but
 * never secret values.
 */
sealed class McpResolutionException : Exception {

    class UnsupportedRepository(
        message: String,
        cause: Throwable? = null,
    ) : McpResolutionException(message, cause)

    class RepositoryFetchFailed(
        val source: String,
        cause: Throwable? = null,
    ) : McpResolutionException(
        "Failed to fetch repository from $source: ${cause?.message ?: "unknown error"}. " +
            "Check the URL/ref and network access.",
        cause,
    )

    class NoDetectorMatched(
        val reasons: List<String>,
    ) : McpResolutionException(
        "Could not determine how to run this project as an MCP server. " +
            "Detected evidence:\n" +
            reasons.joinToString("\n") { "  - $it" } +
            "\nSupported runtimes: Node.js, Python, JVM.",
    )

    class RuntimeNotInstalled(
        val runtime: McpRuntime,
        val command: String,
        hint: String? = null,
    ) : McpResolutionException(
        "Detected a ${runtime.name} MCP project, but the required runtime " +
            "'$command' was not found on PATH. $hint",
    )

    class EntrypointNotFound(
        val runtime: McpRuntime,
        message: String,
    ) : McpResolutionException(message)

    class MissingEnvironment(
        val variable: String,
        val description: String? = null,
    ) : McpResolutionException(
        "Missing required environment variable: $variable" +
            (description?.let { ". $it" } ?: ""),
    )

    class PreparationFailed(
        message: String,
        cause: Throwable? = null,
    ) : McpResolutionException(message, cause)

    class InvalidCommand(
        message: String,
    ) : McpResolutionException(message)

    class StartupProbeFailed(
        message: String,
        cause: Throwable? = null,
    ) : McpResolutionException(message, cause)

    open class McpHandshakeFailed(
        message: String,
        cause: Throwable? = null,
    ) : McpResolutionException(message, cause)

    constructor(message: String, cause: Throwable?) : super(message, cause)
    constructor(message: String) : super(message)
}