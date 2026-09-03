package com.creepyim.mcp.resolver.model

import java.nio.file.Path

/**
 * The thing we are asked to resolve: where does the MCP server live.
 *
 * A remote [Repository] is cloned into a controlled cache directory before
 * inspection; a [LocalDirectory] is used in place and never modified.
 */
sealed interface McpSource {
    data class Repository(
        val url: String,
        val ref: String? = null,
    ) : McpSource

    data class LocalDirectory(
        val path: Path,
    ) : McpSource
}