# IMPLEMENT_LOCAL_GGUF_WITH_CLOUD_FALLBACK.md

> Implementation instruction for the coding agent working on both repositories:
>
> - Frontend: `NU-BSE/frontend`
> - Backend: `NU-BSE/backend`
>
> Goal: keep the existing `llama.rn + GGUF` local inference architecture, complete it properly, and make the app automatically choose/download the correct GGUF model for the assessed Android device. Weak devices or explicit cloud mode must use the existing backend/OpenRouter path.
>
> **Do not replace llama.rn with ONNX.**
> **Do not create a second chat/agent architecture.**
> Extend the architecture that already exists in these repositories.

---

# 0. Read this before changing code

Before writing code:

1. Read both repositories again at current HEAD.
2. In the frontend read `AGENTS.md`; the repository requires using the exact Expo SDK 57 versioned documentation before changing native/Expo integration.
3. Inspect the installed version of `llama.rn` in `package.json` and use only options supported by that version.
4. Read all files referenced below before modifying them.
5. Keep Android as the primary target for local inference.
6. Do not commit GGUF weights to Git.
7. Preserve all existing MCP, connectors, approvals and agent routing unless a concrete compatibility fix is required.

---

# 1. Intended behavior

The final flow must be:

```text
App starts / onboarding
        |
        v
Existing device assessment / attestation
        |
        v
deviceModelSelection.ts
        |
        +-------------------------------+
        |                               |
        | local profile supported       | weak device / cloud profile
        | efficient/balanced/performance|
        v                               v
POST /models/resolve                    Remote TanStack chat
        |                               |
        v                               v
Backend selects approved GGUF       POST /chat/http
model + immutable revision              |
        |                               v
        v                           OpenRouter
Download GGUF from backend/CDN
        |
        v
Verify size + SHA-256
        |
        v
Store in app-private storage
        |
        v
llama.rn initLlama({ model: path, ... })
        |
        v
existing LlmEngine
        |
        v
existing engineConnection()
        |
        v
TanStack AI useChat()
```

For tool/action tasks:

```text
local:
llama.rn -> LlmEngine -> structuredPlanner -> AgentRuntime -> MCP -> approval -> connector

cloud:
remoteAgentModel -> /agent/step -> OpenRouter -> AgentRuntime -> MCP -> approval -> connector
```

Do not move connector/tool execution to the cloud unless the existing architecture explicitly requires it.

---

# 2. Existing frontend architecture to preserve

Read:

```text
src/ai/types.ts
src/ai/AiProvider.tsx
src/ai/index.ts
src/ai/engineConnection.ts
src/ai/engines/onDeviceEngine.ts
src/ai/engines/stubEngine.ts
src/ai/deviceModelSelection.ts
src/ai/modelProfiles.ts
src/ai/config.ts
src/ai/useCreepyChat.ts

src/agent/AgentProvider.tsx
src/agent/models/structuredPlanner.ts
src/agent/models/remoteAgentModel.ts
src/agent/AgentRuntime.ts
src/agent/useAgentChat.ts

app/onboarding/memory.tsx
src/storage/prefs.ts
```

## Important current facts

### `onDeviceEngine.ts` is already based on llama.rn

The current code already does the correct core local inference pattern:

```ts
const mod = require('llama.rn')
const context = await initLlama({
  model: modelPath,
  n_ctx: contextSize,
  n_gpu_layers: gpuLayers,
})
```

Generation already uses:

```ts
context.completion(
  {
    messages,
    n_predict: maxTokens,
    temperature,
    stop,
  },
  onToken,
)
```

and streams token deltas through `AsyncQueue`.

This is the desired runtime.

**Do not rewrite the inference runtime to ONNX.**

Instead, replace the current manual `modelPath` configuration with a backend-resolved/downloaded GGUF model.

---

# 3. Architectural principle

The local runtime stack should remain:

```text
GGUF file
  ↓
llama.rn
  ↓
LlmEngine
  ↓
engineConnection()
  ↓
TanStack ConnectionAdapter
  ↓
useChat()
```

TanStack AI does not need to know anything about GGUF or llama.cpp.

Do not:

- import `llama.rn` from React screens;
- call `completion()` directly from `useCreepyChat`;
- create a custom chat state implementation;
- replace `engineConnection()`.

---

# 4. Existing device assessment remains authoritative for UX

Read:

```text
src/attestation/client/deviceAssessment.ts
src/attestation/native/AttestationNativeProbes.ts
src/attestation/native/android/...
src/ai/deviceModelSelection.ts
app/onboarding/memory.tsx
```

The frontend already assesses:

- Android platform
- supported ABI
- CPU cores
- total RAM
- free storage
- Android SDK
- low-RAM state
- device integrity
- thermal/power information where available

and maps the device to:

```text
efficient
balanced
performance
cloud
```

Keep this system.

Do not create another unrelated device classifier on the backend.

The backend should only perform defensive validation and map a profile to a concrete model.

---

# 5. Replace manual GGUF paths with backend model resolution

Current code uses environment variables such as:

```text
EXPO_PUBLIC_LLM_MODEL_PATH
EXPO_PUBLIC_LLM_MODEL_EFFICIENT_PATH
EXPO_PUBLIC_LLM_MODEL_BALANCED_PATH
EXPO_PUBLIC_LLM_MODEL_PERFORMANCE_PATH
```

These should no longer be the normal production model source.

The final production behavior should be:

```text
MemoryProfile
   ↓
backend /models/resolve
   ↓
modelId + revision + GGUF metadata
   ↓
download
   ↓
verified local path
   ↓
createOnDeviceEngine({ modelPath })
```

Development-only direct-path overrides may remain if clearly marked as dev-only.

---

# 6. Backend: model catalog

Add a backend-owned model catalog.

Suggested files:

```text
app/api/routes/models.py
app/schemas/models.py
app/services/model_catalog.py
app/services/model_distribution.py
```

Update:

```text
app/core/config.py
app/main.py
.env.example
README.md
```

Add tests:

```text
tests/test_model_catalog.py
tests/test_models.py
```

---

# 7. Backend model catalog format

Suggested catalog:

```json
{
  "schemaVersion": 1,
  "profiles": {
    "efficient": {
      "modelId": "creepy-small-q4",
      "revision": "2026-08-12.1"
    },
    "balanced": {
      "modelId": "creepy-medium-q4",
      "revision": "2026-08-12.1"
    },
    "performance": {
      "modelId": "creepy-large-q4",
      "revision": "2026-08-12.1"
    }
  },
  "models": {
    "creepy-small-q4@2026-08-12.1": {
      "format": "gguf",
      "quantization": "Q4_K_M",
      "fileName": "model.gguf",
      "sizeBytes": 650000000,
      "sha256": "...",
      "minimumSdkInt": 26,
      "requiredAbis": ["arm64-v8a"],
      "runtime": {
        "contextSize": 1024,
        "maxTokens": 192,
        "gpuLayers": 0,
        "threads": 4
      }
    }
  }
}
```

Fields may be adjusted to the actual llama.rn API.

Important:

- `revision` is immutable;
- modifying weights creates a new revision;
- every model has exact size and SHA-256;
- client cannot request an arbitrary disk path;
- only models present in the catalog can be downloaded.

---

# 8. Model selection strategy

The exact model names are product/configuration data, not hardcoded architecture.

Recommended concept:

```text
efficient
  -> smallest supported instruct GGUF
  -> aggressive quantization if needed
  -> small context

balanced
  -> medium model
  -> Q4_K_M or another tested quantization
  -> medium context

performance
  -> larger model
  -> higher context
```

Do not equate profile names directly with parameter counts in application logic.

The current UI text like `512MB`, `1B`, `1.5B` is fragile because actual GGUF size depends on parameter count, quantization, model architecture and vocabulary.

Use backend-provided actual `sizeBytes` for download size.

---

# 9. Quantization policy

The backend catalog should explicitly identify GGUF quantization.

Variants to evaluate may include:

```text
Q4_K_M
Q4_K_S
Q5_K_M
Q8_0
```

Do not dynamically quantize on the phone.

Only distribute already prepared/tested GGUF weights.

Selection must consider:

- memory;
- model load time;
- time-to-first-token;
- tokens/sec;
- thermal behavior;
- response quality.

---

# 10. Backend `/models/resolve`

Implement:

```http
POST /models/resolve
Authorization: Bearer <access token>
Content-Type: application/json
```

Suggested request:

```json
{
  "profile": "balanced",
  "assessmentSchemaVersion": 1,
  "platform": "android",
  "sdkInt": 36,
  "supportedAbis": ["arm64-v8a"],
  "cpuCoreCount": 8,
  "totalMemoryBytes": 8589934592,
  "availableStorageBytes": 21474836480,
  "lowRamDevice": false,
  "runtimeCapabilities": {
    "llamaRn": true
  }
}
```

Send only capability information needed for model resolution.

Suggested local response:

```json
{
  "mode": "local",
  "profile": "balanced",
  "model": {
    "modelId": "creepy-medium-q4",
    "revision": "2026-08-12.1",
    "format": "gguf",
    "quantization": "Q4_K_M",
    "fileName": "model.gguf",
    "sizeBytes": 1180000000,
    "sha256": "...",
    "downloadUrl": "/models/files/creepy-medium-q4/2026-08-12.1/model.gguf",
    "runtime": {
      "contextSize": 2048,
      "maxTokens": 320,
      "gpuLayers": 0,
      "threads": 6
    }
  }
}
```

Suggested cloud response:

```json
{
  "mode": "cloud",
  "reason": "device_capability_mismatch"
}
```

Stable reason codes:

```text
local_models_disabled
unsupported_platform
unsupported_abi
sdk_too_old
insufficient_memory
insufficient_storage
low_ram_device
runtime_unavailable
profile_not_found
```

---

# 11. Backend model download route

Implement:

```http
GET /models/files/{model_id}/{revision}/{filename}
Authorization: Bearer <access token>
```

Requirements:

1. Serve only catalog-whitelisted files.
2. Never accept arbitrary filesystem paths.
3. Validate exact model ID, revision and filename.
4. Return `Content-Length`.
5. Support HTTP Range requests.
6. Test `206 Partial Content`.
7. Return `416` for invalid ranges.
8. Use immutable cache semantics for versioned model files.
9. Do not leak server filesystem paths.

Range support matters because GGUF files can be large.

---

# 12. Optional CDN/object storage

Production-friendly flow:

```text
POST /models/resolve
        |
        v
backend validates profile/device/user
        |
        v
returns signed CDN/object-storage URL
        |
        v
phone downloads GGUF directly
```

Keep the manifest contract stable.

Do not place private object-storage credentials in frontend code.

---

# 13. Frontend model API

Add:

```text
src/ai/models/types.ts
src/ai/models/modelApi.ts
src/ai/models/modelManager.ts
src/ai/models/modelStorage.ts
src/ai/models/index.ts
```

Use existing backend authentication/base URL logic for `/models/resolve`.

Do not download a multi-hundred-MB or multi-GB file through the ordinary JSON helper.

Create a dedicated downloader.

---

# 14. Manifest validation

Use Zod.

Conceptual type:

```ts
type LocalModelManifest = {
  modelId: string;
  revision: string;
  format: 'gguf';
  quantization: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  downloadUrl: string;
  runtime: {
    contextSize: number;
    maxTokens: number;
    gpuLayers: number;
    threads?: number;
  };
};
```

Validate:

- `format === 'gguf'`;
- positive size;
- valid SHA-256 hex;
- safe filename;
- no traversal;
- runtime values inside application safety bounds.

---

# 15. Persistent GGUF storage

Store models in private app storage.

Suggested layout:

```text
<private-no-backup-dir>/
  creepyim-models/
    creepy-medium-q4/
      2026-08-12.1/
        model.gguf
        installation.json
```

Prefer Android no-backup/private files storage.

Do not store weights in AsyncStorage, SecureStore, SQLite blobs, React state or JS base64.

---

# 16. `ModelManager.ensureModel()`

Implement approximately:

```ts
ensureModel(
  profile: LocalMemoryProfile,
  assessment: DeviceAssessment,
  options?: {
    signal?: AbortSignal;
    onProgress?: (progress: ModelInstallProgress) => void;
  },
): Promise<ModelResolution>
```

Possible result:

```ts
type ModelResolution =
  | { mode: 'local'; installed: InstalledLocalModel }
  | { mode: 'cloud'; reason: string };
```

Flow:

```text
1. POST /models/resolve
2. validate manifest
3. check same modelId/revision locally
4. if verified -> reuse
5. refresh available storage
6. ensure sufficient headroom
7. download to model.gguf.part
8. resume partial file with Range
9. verify exact size
10. verify SHA-256
11. atomic rename .part -> model.gguf
12. write installation.json last
13. return absolute GGUF path
```

A model is not installed until verification succeeds.

---

# 17. Download behavior

Requirements:

- bearer authentication;
- progress callback;
- cancellation;
- bounded retries;
- Range resume;
- temp `.part` file;
- single-flight per model revision;
- atomic finalize;
- cleanup corrupt files.

Example:

```ts
type ModelInstallProgress = {
  phase: 'resolving' | 'downloading' | 'verifying' | 'ready';
  modelId?: string;
  revision?: string;
  downloadedBytes?: number;
  totalBytes?: number;
};
```

Do not let multiple React consumers start duplicate downloads.

---

# 18. SHA-256

Hash the GGUF after download.

For large files:

- use streaming/native filesystem hashing;
- do not load the entire GGUF into JS memory;
- do not base64-encode it.

On mismatch:

```text
delete/fail partial
bounded retry
never call initLlama()
```

---

# 19. Storage safety

Refresh free storage immediately before download.

Require:

```text
remaining bytes
+ temporary overhead
+ safety reserve
```

Do not rely only on storage captured during onboarding.

Old inactive model revisions may be cleaned later with a bounded policy.

Never delete the currently active GGUF while llama.rn is using it.

---

# 20. Keep `createOnDeviceEngine` focused

Preferred architecture:

```text
ModelManager
   |
   | verified GGUF path
   v
createOnDeviceEngine({
  modelPath,
  contextSize,
  gpuLayers,
  maxTokens,
  temperature,
  stop,
  threads?
})
```

`createOnDeviceEngine` should remain an inference wrapper, not an HTTP downloader.

---

# 21. Keep lazy `llama.rn` binding

The existing code intentionally resolves `llama.rn` lazily because Expo Go does not contain the native module.

Preserve this behavior unless the exact installed llama.rn + Expo SDK 57 integration requires a supported alternative.

The app must not crash at JS module import when llama.rn is unavailable.

---

# 22. llama.rn runtime configuration

Current code uses:

```text
n_ctx
n_gpu_layers
n_predict
temperature
stop
```

Keep only arguments supported by the installed version.

Evaluate additional options only after checking that version, such as:

```text
n_batch
n_threads
n_threads_batch
use_mlock
use_mmap
```

Do not blindly enable every option.

## `n_gpu_layers`

Keep `0` as safe baseline until GPU offload is tested on representative Android hardware.

## `n_ctx`

Keep context conservative per profile. KV cache costs RAM.

## CPU threads

Do not use every core automatically.

Reserve resources for UI, OS, React Native, connectors and other processes.

---

# 23. Refactor `modelProfiles.ts`

Remove production dependence on `LOCAL_MODEL_PATHS`.

Keep client-side safety caps, for example:

```ts
export const LOCAL_MODEL_RUNTIME = {
  efficient: { contextSize: 1024, maxTokens: 192 },
  balanced: { contextSize: 2048, maxTokens: 320 },
  performance: { contextSize: 3072, maxTokens: 480 },
};
```

When backend and client both provide a limit, use the safer one:

```ts
effectiveContext = Math.min(
  manifest.runtime.contextSize,
  LOCAL_MODEL_RUNTIME[profile].contextSize,
);
```

Do the same for max tokens.

---

# 24. Development direct-path override

It is acceptable to keep a single development-only override:

```text
EXPO_PUBLIC_LLM_DEV_MODEL_PATH
```

Rules:

- use only in dev/explicit forced mode;
- do not make it normal production configuration;
- still use the exact same `llama.rn` engine.

Remove confusing per-profile production paths.

---

# 25. Refactor `src/ai/index.ts`

Today the engine is resolved synchronously using a preconfigured local path.

Production no longer knows the GGUF path until `prepare()`.

Preferred solution:

```ts
createManagedOnDeviceEngine({
  profile,
  assessment,
  modelManager,
})
```

Its `prepare()` should:

```text
ensureModel()
-> create inner createOnDeviceEngine({ modelPath })
-> inner.prepare()
```

This fits the existing `LlmEngine.prepare()` seam.

---

# 26. Managed local engine shape

Conceptually:

```ts
export function createManagedOnDeviceEngine(config): LlmEngine {
  let inner: LlmEngine | null = null;
  let preparing: Promise<void> | null = null;

  return {
    id: 'creepyim-on-device',

    isReady() {
      return inner?.isReady() ?? false;
    },

    prepare() {
      if (inner?.isReady()) return Promise.resolve();
      if (preparing) return preparing;

      preparing = (async () => {
        const resolution = await modelManager.ensureModel(
          config.profile,
          config.assessment,
        );

        if (resolution.mode === 'cloud') {
          throw new LocalModelCloudRequiredError(resolution.reason);
        }

        const manifest = resolution.installed.manifest;

        inner = createOnDeviceEngine({
          modelPath: resolution.installed.modelPath,
          contextSize: safeContext(manifest, config.profile),
          maxTokens: safeMaxTokens(manifest, config.profile),
          gpuLayers: safeGpuLayers(manifest),
        });

        await inner.prepare();
      })().finally(() => {
        preparing = null;
      });

      return preparing;
    },

    async *generate(prompts, options) {
      if (!inner) throw new Error('Local model is not ready');
      yield* inner.generate(prompts, options);
    },

    async dispose() {
      await inner?.dispose();
      inner = null;
    },
  };
}
```

Do not duplicate token-streaming logic that already exists in `createOnDeviceEngine`.

---

# 27. Chat template compatibility

Current llama.rn generation sends message objects.

For every GGUF placed in the backend catalog, validate:

- embedded GGUF chat template;
- system message behavior;
- assistant prefix;
- stop/EOS behavior.

Do not ship a GGUF that requires a completely different prompt format without representing that requirement explicitly.

---

# 28. Stop tokens

Current global defaults may not be correct for every model family.

Allow catalog/model-specific stop tokens if necessary.

Example:

```json
"runtime": {
  "stop": ["<|im_end|>"]
}
```

Validate/cap them on the frontend.

---

# 29. Cancellation and concurrency

Preserve:

```ts
context.stopCompletion()
```

for `AbortSignal`.

Also ensure:

- one context does not run overlapping completions unless supported;
- cancelled token queues close;
- no old-token leakage into new runs;
- event/listener cleanup happens in `finally`.

Add a generation mutex if required.

---

# 30. RAM lifecycle

Desired:

```text
prepare once
generate many turns
dispose when engine changes
```

Do not load the GGUF for every message.

`dispose()` releases llama context from RAM but does not remove the GGUF from disk.

---

# 31. AiProvider model preparation state

Expose enough status to represent:

```text
resolving
downloading
verifying
loading
ready
error
```

For example:

```ts
modelInstall?: {
  phase: 'resolve' | 'download' | 'verify' | 'load';
  downloadedBytes?: number;
  totalBytes?: number;
  modelId?: string;
  revision?: string;
}
```

Keep `origin` accurate.

---

# 32. Onboarding UX

Keep the current profile-selection flow.

For local profiles show:

```text
Preparing local AI…
Downloading 420 MB / 1.1 GB
Verifying…
Loading…
```

Do not navigate into an apparently frozen chat while downloading a large GGUF.

Replace misleading hardcoded size/parameter labels with profile descriptions and actual manifest download size.

---

# 33. Cloud fallback rules

## Weak phone

```text
deviceModelSelection -> cloud
```

Then:

- no model resolve;
- no GGUF download;
- no llama.rn init;
- remote backend only.

## Explicit cloud selection

Same behavior.

## Local-capable phone but local setup fails

Examples:

```text
model resolution failed
insufficient storage
checksum mismatch
llama.rn unavailable
initLlama OOM
GGUF load failure
fatal local generation setup failure
```

If cloud is allowed, switch to remote and set a clear degraded reason.

If cloud is not allowed by entitlement, show a real error.

Do not bypass subscription/entitlement checks.

---

# 34. Production stub behavior

Stub must remain development/test/demo only.

Production:

```text
weak -> remote
local failure -> remote if permitted
remote unavailable/not allowed -> error
```

Do not silently emit canned stub output.

---

# 35. Remote TanStack authentication

Backend `/chat/http` requires authentication.

Ensure `xhrHttpStream` sends:

```http
Authorization: Bearer <access token>
```

using existing token logic.

Prefer dynamic headers so refreshed tokens are not captured forever.

Do not weaken backend auth.

---

# 36. Standardize cloud fallback on OpenRouter

Current backend has:

```text
/chat/http
 -> app/services/llm.py
 -> generic LLM_UPSTREAM_*

/agent/step
 -> app/llm/gateway.py
 -> app/llm/openrouter.py
```

Target: cloud fallback should use OpenRouter.

Add streaming OpenRouter support in the existing OpenRouter module and reuse it from `/chat/http`.

Keep `/agent/step` routing/tool behavior intact.

OpenRouter key remains backend-only.

---

# 37. Cloud model configuration

Prefer a dedicated normal-chat setting:

```env
LLM_MODEL_CHAT=
```

Keep:

```text
LLM_MODEL_FAST
LLM_MODEL_NORMAL
LLM_MODEL_EXPERT
```

for agent tiers.

Normal fallback chat must not accidentally consume expert-tier routing.

---

# 38. Preserve local agent/MCP architecture

Do not redesign:

```text
structuredPlanner
AgentRuntime
MCP
approval flow
connectors
```

Desired local flow:

```text
GGUF
-> llama.rn
-> structuredPlanner
-> validated tool call
-> AgentRuntime
-> MCP
-> approval
-> connector
```

---

# 39. Security

Implement:

1. OpenRouter secret backend-only.
2. Model resolve/download authenticated.
3. No arbitrary model file paths from client.
4. Catalog whitelist only.
5. Immutable revisions.
6. Mandatory size + SHA-256 verification.
7. HTTPS in production.
8. Private app storage.
9. No whole-file JS buffers.
10. No executable payloads in model distribution.
11. Max model size configured.
12. No full raw attestation sent unless needed.
13. Never load unverified GGUF.

---

# 40. Error taxonomy

Frontend:

```text
MODEL_RESOLVE_FAILED
MODEL_CLOUD_REQUIRED
MODEL_NO_STORAGE
MODEL_DOWNLOAD_FAILED
MODEL_RANGE_FAILED
MODEL_CHECKSUM_MISMATCH
LLAMA_RN_UNAVAILABLE
LLAMA_MODEL_LOAD_FAILED
LLAMA_GENERATION_FAILED
MODEL_CANCELLED
```

Backend:

```text
LOCAL_MODELS_DISABLED
MODEL_PROFILE_NOT_FOUND
MODEL_DEVICE_UNSUPPORTED
MODEL_NOT_FOUND
MODEL_FILE_NOT_FOUND
MODEL_RANGE_INVALID
```

Prefer typed/stable errors over string matching.

---

# 41. Backend tests

Test:

```text
catalog validation
auth on resolve/download
profile mappings
unsupported ABI
low RAM
old SDK
Range 206
invalid Range 416
path traversal
revision mismatch
unknown file
OpenRouter cloud stream regression
/agent/step regression
```

---

# 42. Frontend tests

Extend existing verification scripts and add focused tests for:

```text
manifest validation
ModelManager
download resume
checksum validation
single-flight
storage failure
managed llama engine
AbortSignal -> stopCompletion
dispose -> release
TanStack AG-UI stream
cloud auth header
no production stub fallback
```

Mock llama.rn for Node-level tests.

---

# 43. Performance validation

For each supported profile, record on representative Android phones:

```text
model load time
time-to-first-token
prompt processing speed
generation tokens/sec
peak memory if measurable
thermal behavior
UI responsiveness
OOM/crash behavior
```

Adjust profile-to-model mapping based on real measurements.

---

# 44. Optional adaptive downgrade

Later, after core implementation is stable, a short first-run benchmark may downgrade:

```text
performance -> balanced
balanced -> efficient
efficient -> cloud
```

based on real tokens/sec or memory behavior.

Do not make this part of the first required pass.

---

# 45. Implementation order

## Phase 1 — backend catalog

1. schemas;
2. catalog loader;
3. `/models/resolve`;
4. GGUF download endpoint;
5. Range support;
6. tests;
7. config/docs.

## Phase 2 — frontend ModelManager

1. Zod manifest;
2. resolve API;
3. private model storage;
4. resumable downloader;
5. SHA-256;
6. installation metadata;
7. tests.

## Phase 3 — managed llama.rn engine

1. preserve current inference engine;
2. add managed preparation wrapper;
3. resolve/download GGUF in `prepare()`;
4. pass verified local path to `createOnDeviceEngine`;
5. tests.

## Phase 4 — fallback/routing

1. remove production per-profile path envs;
2. update `modelProfiles`;
3. update `src/ai/index.ts`;
4. update `AiProvider`;
5. remote auth;
6. production no-stub fallback.

## Phase 5 — OpenRouter consistency

1. streaming helper;
2. `/chat/http` -> OpenRouter;
3. preserve `/agent/step`.

## Phase 6 — UX/E2E

1. model download progress;
2. real sizes;
3. cancel/retry;
4. physical Android tests;
5. README.

---

# 46. Likely frontend files

```text
.env.example
src/ai/index.ts
src/ai/AiProvider.tsx
src/ai/config.ts
src/ai/modelProfiles.ts
src/ai/engines/onDeviceEngine.ts

src/ai/models/types.ts
src/ai/models/modelApi.ts
src/ai/models/modelStorage.ts
src/ai/models/modelManager.ts

app/onboarding/memory.tsx

scripts/verify-model-manager.mts
scripts/verify-llama-model-selection.mts
```

Usually keep these architectural seams intact:

```text
src/ai/engineConnection.ts
src/ai/useCreepyChat.ts
src/agent/models/structuredPlanner.ts
src/agent/AgentRuntime.ts
packages/mcp-*
packages/connector-*
```

---

# 47. Likely backend files

```text
app/core/config.py
app/main.py
.env.example
README.md

app/api/routes/models.py
app/schemas/models.py
app/services/model_catalog.py
app/services/model_distribution.py

app/llm/openrouter.py
app/services/llm.py

tests/test_model_catalog.py
tests/test_models.py
```

---

# 48. Do not do these things

Do **not**:

- migrate to ONNX;
- introduce ONNX Runtime or ORT GenAI;
- build a custom inference bridge while llama.rn already exists;
- replace GGUF;
- call llama.rn from screens;
- replace TanStack useChat;
- bypass `engineConnection`;
- rebuild MCP;
- expose OpenRouter key;
- store GGUF in AsyncStorage/SecureStore;
- read full GGUF into JS memory;
- hash via full-file base64;
- accept arbitrary server file paths;
- use per-profile `EXPO_PUBLIC_*` model paths as production distribution;
- load unverified weights;
- use stub as production fallback;
- blindly enable GPU offload;
- use all CPU cores automatically;
- set giant context windows;
- redownload unchanged verified models every startup.

---

# 49. Definition of Done

- [ ] Local runtime remains `llama.rn + GGUF`.
- [ ] Existing token-streaming `LlmEngine` remains.
- [ ] Device assessment selects local/cloud profile.
- [ ] Weak phones download zero GGUF.
- [ ] Backend catalog maps profile to model/revision.
- [ ] `/models/resolve` exists and is authenticated.
- [ ] Download supports Range/resume.
- [ ] Progress is visible.
- [ ] File size verified.
- [ ] SHA-256 verified.
- [ ] GGUF stored in private persistent storage.
- [ ] Verified revision reused after restart.
- [ ] New revision installs separately.
- [ ] `initLlama()` gets only verified local path.
- [ ] Context loads once and is reused.
- [ ] `completion()` streams token deltas.
- [ ] Abort calls `stopCompletion()`.
- [ ] Dispose calls `release()`.
- [ ] `engineConnection()` continues driving TanStack AI.
- [ ] Structured planner/MCP still works locally.
- [ ] Remote TanStack requests include bearer auth.
- [ ] `/chat/http` uses OpenRouter cloud path.
- [ ] `/agent/step` remains working.
- [ ] OpenRouter secret stays backend-only.
- [ ] Production does not silently use stub.
- [ ] Backend tests pass.
- [ ] Frontend typecheck/lint/verification passes.
- [ ] Actual GGUF runs on representative Android hardware.
- [ ] Strong-device, weak-device, interrupted-download, corrupt-download, OOM and restart scenarios are tested.

---

# 50. Final target architecture

```text
                    ┌───────────────────────────┐
                    │ Existing device           │
                    │ assessment / attestation  │
                    └─────────────┬─────────────┘
                                  │
                                  v
                    ┌───────────────────────────┐
                    │ deviceModelSelection.ts   │
                    └──────────┬────────┬───────┘
                               │        │
                         local │        │ weak/cloud
                               │        │
                               v        v
                    ┌────────────────┐  ┌──────────────────────┐
                    │ /models/resolve│  │ xhrHttpStream        │
                    └───────┬────────┘  │ /chat/http           │
                            │           └──────────┬───────────┘
                            v                      │
                    ┌────────────────┐             v
                    │ model manifest │       ┌──────────────┐
                    │ GGUF + SHA     │       │ OpenRouter   │
                    └───────┬────────┘       └──────────────┘
                            │
                            v
                    ┌────────────────┐
                    │ ModelManager   │
                    │ download       │
                    │ resume         │
                    │ verify         │
                    └───────┬────────┘
                            │ verified path
                            v
                    ┌────────────────┐
                    │ llama.rn       │
                    │ initLlama      │
                    │ completion     │
                    └───────┬────────┘
                            │ token callbacks
                            v
                    ┌────────────────┐
                    │ LlmEngine      │
                    └───────┬────────┘
                            │
                            v
                    ┌────────────────┐
                    │engineConnection│
                    │ AG-UI chunks   │
                    └───────┬────────┘
                            │
                            v
                    ┌────────────────┐
                    │ TanStack useChat│
                    └────────────────┘
```

Agent path:

```text
local:
GGUF -> llama.rn -> structuredPlanner -> AgentRuntime -> MCP -> approval -> connector

remote:
remoteAgentModel -> /agent/step -> OpenRouter -> AgentRuntime -> MCP -> approval -> connector
```

The main engineering task is therefore **not replacing the local inference runtime**. The main task is completing the production pieces around the existing llama.rn implementation:

```text
device profile
-> backend model catalog
-> GGUF distribution
-> resumable download
-> checksum verification
-> persistent model cache
-> llama.rn load
-> TanStack stream
-> cloud fallback
```
