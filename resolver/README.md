# MCP resolver — Kotlin/JVM core

The detection + resolution engine behind `@mobile-agent/mcp-resolver`. It
answers one question: **how do I run this MCP server over stdio?**

```
Git repository / local MCP server source
        ↓
RepositoryManager (clone/fetch into a controlled cache)
        ↓
RepositoryContext
        ↓
McpProjectDetector(s)  — Node / Python / JVM
        ↓
DefaultMcpResolver     — best confidence, best launch candidate
        ↓
ResolvedMcp(command, args, workingDirectory, requiredEnvironmentVariables, …)
        ↓
resolver-cli           — JSON stdio bridge for non-JVM callers (the TS adapter)
```

The core has **no dependency on ADK or any agent framework** — it only produces a
structured process description. Framework integration lives in
`packages/mcp-resolver`.

## Build

```bash
./gradlew test          # unit tests (fixture repositories)
./gradlew installDist   # launcher: build/install/resolver-cli/bin/resolver-cli
./gradlew fatJar        # java -jar build/libs/mcp-resolver-0.1.0-fat.jar
```

Requires a JDK 17+. Gradle is bootstrapped via the wrapper (`./gradlew`).

## CLI protocol

`stdout` carries JSON, `stderr` carries logs (mirroring the MCP stdio
convention). Secrets never cross this boundary: the CLI reports required
variable *names* only.

```bash
resolver-cli resolve '{"url":"https://github.com/org/mcp-server","ref":"main"}'
resolver-cli resolve '{"path":"/tmp/repo"}'
resolver-cli resolve --prepare --validate '{"path":"/tmp/repo"}'
```

Success:

```json
{
  "command": "node",
  "args": ["dist/index.js"],
  "workingDirectory": "/tmp/repo",
  "requiredEnvironmentVariables": [{ "name": "GITHUB_TOKEN", "required": true }],
  "runtime": "NODE",
  "confidence": 0.9,
  "evidence": ["package.json bin: dist/index.js"],
  "requiresPreparation": false
}
```

Failure (non-zero exit + envelope):

```json
{ "error": { "type": "NoDetectorMatched", "message": "…", "hints": ["…"] } }
```

## Supported runtimes

| Runtime | Detection | Launch forms |
| --- | --- | --- |
| Node.js / TypeScript | `package.json`, lockfiles, `bin`, `main`, scripts, README MCP config | `node <bin>`, `npx -y <pkg>`, `npm run <script>`, README-documented command |
| Python | `pyproject.toml`, `requirements.txt`, `setup.py/cfg`, `uv.lock`, `poetry.lock` | `uv run <script>`, `poetry run <script>`, `python -m <module>` |
| JVM | `build.gradle(.kts)`, `pom.xml`, `gradlew`, `mvnw` | `java -jar <artifact>` (preferred), `./gradlew run`, `./mvnw spring-boot:run` |

Detectors implement `McpProjectDetector`; add Go/Rust/.NET/Docker/Deno/Bun by
adding a detector — the resolver picks the most confident match.

## Resolution strategy (evidence order)

1. explicit MCP config (README `mcpServers` JSON);
2. package/application executable metadata (`bin`, `[project.scripts]`);
3. manifest entrypoint (`main`, module entrypoint);
4. build configuration (Gradle `application`, Maven exec/Spring Boot);
5. heuristics (existing `dist/index.js`, `index.js`) — last resort.

`command` and `args` are strictly separated. Shell strings from READMEs are
never executed (`CommandSafety` rejects metacharacters, quoting, traversal).

## Security

- repositories are untrusted; nothing from a repository is executed as shell;
- preparation uses fixed, known commands (`npm ci`, `npm run build`, `uv sync`);
- remote repositories are cloned into a controlled cache, reused across runs;
- the resolver never invents secret values; it only reports variable names.