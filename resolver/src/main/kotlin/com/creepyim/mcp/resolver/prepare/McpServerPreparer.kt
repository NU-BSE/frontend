package com.creepyim.mcp.resolver.prepare

import com.creepyim.mcp.resolver.context.RepositoryContext
import com.creepyim.mcp.resolver.model.ResolvedMcp

/**
 * Turns a resolved launch into a runnable one (install dependencies, build
 * artifacts). Kept separate from resolution so `resolve` stays free of side
 * effects and callers decide whether and when to prepare.
 */
interface McpServerPreparer {
    fun prepare(resolved: ResolvedMcp, context: RepositoryContext)
}