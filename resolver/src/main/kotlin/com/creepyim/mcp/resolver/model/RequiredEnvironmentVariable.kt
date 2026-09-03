package com.creepyim.mcp.resolver.model

/**
 * A variable the MCP server may need at runtime.
 *
 * [required] is advisory metadata produced by static analysis; the resolver
 * never invents secret *values*. The caller decides which values to supply.
 */
data class RequiredEnvironmentVariable(
    val name: String,
    val required: Boolean,
    val description: String? = null,
)