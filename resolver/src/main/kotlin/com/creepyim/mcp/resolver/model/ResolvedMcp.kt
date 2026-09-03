package com.creepyim.mcp.resolver.model

import java.nio.file.Path

/**
 * The unified, structured description of how to start an MCP server over
 * stdio. `stdout` and `stdin` carry the MCP protocol; `stderr` carries logs.
 *
 * `command` and `args` are strictly separated — never a shell string. The
 * resolver never invents secret values; it only reports which variables are
 * needed and the caller supplies actual values.
 */
data class ResolvedMcp(
    val command: String,
    val args: List<String> = emptyList(),
    /** Actual environment values (already merged by the caller-provided env). */
    val environment: Map<String, String> = emptyMap(),
    val workingDirectory: Path? = null,
    /** Variables the server is expected to need. Values are NOT included. */
    val requiredEnvironmentVariables: List<RequiredEnvironmentVariable> = emptyList(),
    val runtime: McpRuntime = McpRuntime.OTHER,
    /** How confident the resolver is in this result (0..1). */
    val confidence: Double = 0.0,
    /** Human-readable reasons that led to this command, in priority order. */
    val evidence: List<String> = emptyList(),
    /** True when the launch only works after preparation (install/build). */
    val requiresPreparation: Boolean = false,
    /** Short human description of the selected launch path. */
    val launchDescription: String? = null,
) {
    fun executablePath(): Path? = workingDirectory?.resolve(command)
}