package com.creepyim.mcp.resolver.resolver

import com.creepyim.mcp.resolver.context.RepositoryContext
import com.creepyim.mcp.resolver.context.RepositoryManager
import com.creepyim.mcp.resolver.detector.DetectionResult
import com.creepyim.mcp.resolver.detector.JvmMcpDetector
import com.creepyim.mcp.resolver.detector.LaunchCandidate
import com.creepyim.mcp.resolver.detector.McpProjectDetector
import com.creepyim.mcp.resolver.detector.NodeMcpDetector
import com.creepyim.mcp.resolver.detector.PythonMcpDetector
import com.creepyim.mcp.resolver.exception.McpResolutionException
import com.creepyim.mcp.resolver.model.McpRuntime
import com.creepyim.mcp.resolver.model.McpSource
import com.creepyim.mcp.resolver.model.ResolvedMcp
import com.creepyim.mcp.resolver.util.CommandSafety
import com.creepyim.mcp.resolver.util.EnvDetector

/**
 * Runs every detector, selects the most confident match and picks the most
 * production-like launch candidate from it.
 */
class DefaultMcpResolver(
    private val repositoryManager: RepositoryManager = RepositoryManager(),
    private val detectors: List<McpProjectDetector> = listOf(
        NodeMcpDetector(),
        PythonMcpDetector(),
        JvmMcpDetector(),
    ),
) : McpResolver {

    private val runtimePreference = listOf(McpRuntime.NODE, McpRuntime.PYTHON, McpRuntime.JVM)

    override fun resolve(source: McpSource): ResolvedMcp {
        val context = repositoryManager.materialize(source)
        return resolveContext(context)
    }

    fun resolveContext(context: RepositoryContext): ResolvedMcp {
        val detections = detectors.mapNotNull { it.detect(context) }

        val best = selectBest(detections, context)
        if (best == null) {
            throw McpResolutionException.NoDetectorMatched(
                detections.flatMap { it.evidence }.ifEmpty { listOf("no project manifest found") },
            )
        }

        val candidate = best.candidates
            .filter { CommandSafety.validateCommand(it.command, context.root) && CommandSafety.validateArgs(it.args) }
            .minWithOrNull(compareBy<LaunchCandidate> { it.priority }.thenBy { it.requiresPreparation })
            ?: throw McpResolutionException.EntrypointNotFound(
                best.runtime,
                "No launchable entrypoint survived validation for this ${best.runtime.name} project.",
            )

        if (candidate.workingDirectory != null &&
            !CommandSafety.validateWorkingDirectory(candidate.workingDirectory, context.root)
        ) {
            throw McpResolutionException.InvalidCommand(
                "Working directory ${candidate.workingDirectory} is not a valid directory inside the repository.",
            )
        }

        val requiredEnvironmentVariables = EnvDetector.detect(context)

        return ResolvedMcp(
            command = candidate.command,
            args = candidate.args,
            workingDirectory = candidate.workingDirectory,
            requiredEnvironmentVariables = requiredEnvironmentVariables,
            runtime = best.runtime,
            confidence = best.confidence,
            evidence = best.evidence,
            requiresPreparation = candidate.requiresPreparation,
            launchDescription = candidate.description,
        )
    }

    private fun selectBest(detections: List<DetectionResult>, context: RepositoryContext): DetectionResult? {
        if (detections.isEmpty()) return null
        val sorted = detections.sortedWith(
            compareByDescending<DetectionResult> { it.confidence }
                .thenBy { runtimePreference.indexOf(it.runtime).let { idx -> if (idx < 0) Int.MAX_VALUE else idx } },
        )
        val best = sorted.first()
        // A detector may have matched but produced no launchable candidate;
        // prefer a slightly-less-confident detector that actually has one.
        if (best.candidates.isNotEmpty()) return best
        return sorted.firstOrNull { it.candidates.isNotEmpty() }
    }
}