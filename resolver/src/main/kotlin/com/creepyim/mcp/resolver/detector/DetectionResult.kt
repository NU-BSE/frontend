package com.creepyim.mcp.resolver.detector

import com.creepyim.mcp.resolver.model.McpRuntime
import java.nio.file.Path

/**
 * One possible way to launch the server. [priority] orders candidates within a
 * detection: lower is more production-like (a runnable artifact beats a dev
 * task).
 */
data class LaunchCandidate(
    val command: String,
    val args: List<String> = emptyList(),
    val workingDirectory: Path? = null,
    val priority: Int = 10,
    val requiresPreparation: Boolean = false,
    val description: String,
)

/**
 * The result of one detector for one repository. [confidence] is 0..1.
 */
data class DetectionResult(
    val runtime: McpRuntime,
    val confidence: Double,
    val evidence: List<String>,
    val candidates: List<LaunchCandidate>,
)