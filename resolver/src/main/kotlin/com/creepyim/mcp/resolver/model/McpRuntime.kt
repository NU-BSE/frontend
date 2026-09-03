package com.creepyim.mcp.resolver.model

/**
 * The runtime ecosystem the MCP server project belongs to.
 */
enum class McpRuntime {
    NODE,
    PYTHON,
    JVM,
    OTHER;

    companion object {
        fun parse(value: String): McpRuntime = entries.firstOrNull { it.name == value } ?: OTHER
    }
}