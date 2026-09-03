package com.creepyim.mcp.resolver.detector

import com.creepyim.mcp.resolver.context.RepositoryContext
import com.creepyim.mcp.resolver.model.McpRuntime

/**
 * A detector recognises one runtime ecosystem and produces the launch
 * candidates for it. Detectors must be independent and deterministic; the
 * top-level resolver picks the most confident result.
 *
 * Extend with a new detector (Go, Rust, .NET, Docker, Deno, Bun, ...) to add
 * runtime support without touching the resolver.
 */
interface McpProjectDetector {
    val runtime: McpRuntime

    fun detect(context: RepositoryContext): DetectionResult?
}