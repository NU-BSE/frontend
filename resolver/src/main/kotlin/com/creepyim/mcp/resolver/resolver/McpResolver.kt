package com.creepyim.mcp.resolver.resolver

import com.creepyim.mcp.resolver.model.McpSource
import com.creepyim.mcp.resolver.model.ResolvedMcp

/**
 * Answers one question: "how do I run this MCP server over stdio?"
 *
 * The resolver is framework-agnostic: it knows nothing about ADK, agents or
 * tool registries. It only returns a structured process description.
 */
interface McpResolver {
    fun resolve(source: McpSource): ResolvedMcp
}