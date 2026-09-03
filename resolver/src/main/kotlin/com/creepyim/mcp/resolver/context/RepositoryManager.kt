package com.creepyim.mcp.resolver.context

import com.creepyim.mcp.resolver.exception.McpResolutionException
import com.creepyim.mcp.resolver.model.McpSource
import java.io.File
import java.nio.channels.FileChannel
import java.nio.channels.FileLock
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardOpenOption
import java.security.MessageDigest

/**
 * Prepares a repository for inspection:
 *
 * - [McpSource.Repository] is cloned/fetched into a controlled cache directory
 *   and reused across requests (no re-clone when the revision is already
 *   present). The checkout is never a path the user controls and never gets
 *   destructive operations applied to it.
 * - [McpSource.LocalDirectory] is used in place, read-only.
 */
class RepositoryManager(
    private val cacheRoot: Path = defaultCacheRoot(),
) {
    init {
        Files.createDirectories(cacheRoot)
    }

    fun materialize(source: McpSource): RepositoryContext = when (source) {
        is McpSource.LocalDirectory -> {
            val root = normalizeLocalPath(source.path).toAbsolutePath().normalize()
            if (!Files.isDirectory(root)) {
                throw McpResolutionException.UnsupportedRepository(
                    "Local directory does not exist or is not a directory: $root",
                )
            }
            RepositoryContext(root, source)
        }

        is McpSource.Repository -> {
            val root = checkout(source)
            RepositoryContext(root, source)
        }
    }

    /**
     * WSL interop: a Windows-style absolute path (`C:\foo\bar`) given to a
     * Linux JVM almost certainly refers to a WSL mount. Map it to `/mnt/c/foo/bar`
     * so resolution works in mixed WSL environments. No-op elsewhere.
     */
    internal fun normalizeLocalPath(path: Path): Path {
        if (System.getProperty("os.name").startsWith("Windows")) return path
        val text = path.toString()
        val match = WINDOWS_DRIVE_PATH.matchEntire(text) ?: return path
        val drive = match.groupValues[1].lowercase()
        val rest = match.groupValues[2].split('/', '\\').filter { it.isNotBlank() }
        return Path.of("/mnt", drive, *rest.toTypedArray())
    }

    private fun checkout(source: McpSource.Repository): Path {
        val url = source.url
        val key = sha256("$url#${source.ref ?: "HEAD"}")
        val dir = cacheRoot.resolve(key).toAbsolutePath().normalize()

        if (!dir.startsWith(cacheRoot)) {
            throw McpResolutionException.UnsupportedRepository("Invalid repository key")
        }

        if (!Files.isDirectory(dir.resolve(".git"))) {
            // Acquire an exclusive lock so two concurrent requests cannot clone
            // the same repository simultaneously.
            lock(key) {
                if (!Files.isDirectory(dir.resolve(".git"))) {
                    runCatching { clone(url, dir) }.getOrElse { error ->
                        throw McpResolutionException.RepositoryFetchFailed(url, error)
                    }
                }
            }
        }

        val ref = source.ref
        if (ref != null) {
            runCatching { fetchAndCheckout(dir, ref) }.getOrElse { error ->
                throw McpResolutionException.RepositoryFetchFailed("$url@$ref", error)
            }
        }

        return dir
    }

    private fun clone(url: String, dir: Path) {
        Files.createDirectories(dir.parent)
        exec(listOf("git", "clone", "--quiet", "--depth", "1", url, dir.toString()), dir.parent, cacheRoot)
    }

    private fun fetchAndCheckout(dir: Path, ref: String) {
        exec(listOf("git", "fetch", "--quiet", "--depth", "1", "origin", ref), dir, cacheRoot)
        exec(listOf("git", "checkout", "--quiet", "FETCH_HEAD"), dir, cacheRoot)
    }

    private fun lock(key: String, action: () -> Unit) {
        val lockFile = cacheRoot.resolve("$key.lock")
        FileChannel.open(
            lockFile,
            StandardOpenOption.CREATE,
            StandardOpenOption.WRITE,
        ).use { channel ->
            val lock: FileLock = channel.lock()
            try {
                action()
            } finally {
                lock.release()
            }
        }
    }

    private fun exec(command: List<String>, workingDir: Path, allowedRoot: Path) {
        val process = ProcessBuilder(command)
            .directory(workingDir.toFile())
            .redirectErrorStream(false)
            .start()

        val stderr = process.errorStream.readBytes().toString(StandardCharsets.UTF_8)
        val exit = process.waitFor()
        if (exit != 0) {
            throw McpResolutionException.RepositoryFetchFailed(
                "git ${command.drop(1).joinToString(" ")} failed with exit code $exit: $stderr",
            )
        }
    }

    private fun sha256(input: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        return digest.digest(input.toByteArray(StandardCharsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
            .take(24)
    }

    companion object {
        private val WINDOWS_DRIVE_PATH = Regex("""^([A-Za-z]):[\\/](.*)$""")

        fun defaultCacheRoot(): Path {
            val home = System.getProperty("user.home") ?: "/tmp"
            return Path.of(home, ".creepyim", "mcp-resolver", "cache")
        }
    }
}