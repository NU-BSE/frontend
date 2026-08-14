# @mobile-agent/content-engine

Architecture scaffold for task-oriented reading, searching, extracting, creating and editing of documents and other file-backed content.

This package is intentionally **contract-only** in this PR. It defines boundaries, types and adapter slots, but contains no parser, writer, network client, storage implementation or MCP registration logic yet.

## Goals

- Give the agent a small, format-agnostic document API instead of format-specific tools such as `read_xlsx` or `edit_docx`.
- Separate where content lives (source adapters) from how a format is interpreted (format adapters) from where an operation executes (execution routing).
- Preserve native document semantics during writes by applying patches through the native format adapter instead of round-tripping every document through plain text.
- Support inspection and bounded/chunked reads before loading large documents into model context.
- Keep stable location references for sheets/cells, pages, paragraphs, slides and other editable regions.
- Validate mutations before persistence and leave room for revisions/versioning.
- Keep execution location (local, native API, remote) an internal decision — the LLM never learns where a document was processed.

## Intended flow

```text
Agent / MCP tools
      |
      v
DocumentEngine
      |
      v
DocumentOrchestrator
      |
      |  resolve → inspect (complexity) → ProcessingContext
      |
      v
ExecutionRouter  ──────────────> ExecutionPlan
      |                            |
      |        ┌───────────────────┼───────────────────┐
      v        v                   v                   v
   LOCAL    NATIVE_API           REMOTE          ProcessorRegistry
      |        |                   |
      v        v                   v
 Source/Format   Provider APIs      Backend processor
  adapters      Sheets/Docs/…       OCR / conversion
                                    huge documents
```

## High-level agent surface

The future MCP layer should expose task-oriented operations only:

- `document.find`
- `document.inspect`
- `document.read`
- `document.search`
- `document.extract`
- `document.create`
- `document.update`
- `document.convert`
- `document.save`

The engine selects source adapter, format adapter **and** execution target internally. The MCP API never splits into `readLocal` / `readRemote` / `readGoogle`.

## Source adapters

Scaffolded slots exist for Google Drive, Google Sheets, Google Docs, Google Slides, local device files, backend files, Telegram and OneDrive.

Cloud-native documents should use their native APIs where possible. For example, Google Sheets should eventually use the Sheets API rather than export to XLSX for every operation.

## Format adapters

Scaffolded slots exist for XLS/XLSX, CSV, DOCX, PDF, PPTX, text, Markdown, HTML, JSON and images.

## Write model

Writes are represented as targeted patch operations. A future XLSX adapter should update the existing workbook so formulas/styles/charts are preserved; a future DOCX adapter should modify the existing package rather than regenerate it from extracted text.

---

# Execution Architecture

Content Engine is built around a single principle:

```text
LOCAL-FIRST
  + REMOTE FALLBACK
  + NATIVE CLOUD API
```

The LLM does not know where a document operation physically ran. It always calls the same surface — `document.inspect()`, `document.read()`, `document.search()`, `document.extract()`, `document.create()`, `document.update()`, `document.convert()`, `document.save()` — and the execution strategy is chosen inside the engine.

```text
                 LLM / MCP
                     │
                     ▼
               DocumentEngine
                     │
                     ▼
             DocumentOrchestrator
                     │
                     ▼
               ExecutionRouter
                     │
       ┌─────────────┼──────────────┐
       │             │              │
       ▼             ▼              ▼
    LOCAL        NATIVE_API       REMOTE
       │             │              │
       ▼             ▼              ▼
 Format adapters Provider APIs   Backend processor
 XLSX/DOCX/PDF   Sheets/Docs     OCR / conversion
 CSV/PPTX/etc.   Slides/etc.     huge documents
```

## Three execution targets

### `local`

Processing on the device. Future coverage: TXT, Markdown, JSON, CSV, small-to-medium XLSX/DOCX/PPTX, PDFs with a normal text layer, simple editing and document creation.

### `native-api`

The document is not downloaded and parsed as a binary file; it is addressed through its provider API. Examples: Google Sheets → Sheets API, Google Docs → Docs API, Google Slides → Slides API. May later include Microsoft Excel/Word Online, Notion and other cloud-native document APIs.

The critical rule for `native-api`: a Google Sheet must **not** be forced through `export XLSX → download → XlsxAdapter` for every operation. The preferred flow is `Google Sheet → NativeApiDocumentProcessor → Google Sheets Adapter/API`.

### `remote`

Processing through a separate backend/document-processing service. Future coverage: OCR, scanned PDF, very large XLSX/PDF, legacy DOC/PPT, Office → PDF, PDF → editable, complex PDF editing, heavy computation and long-running document jobs.

## Local-first

When `execution` is `"auto"`, routing follows this order:

```text
1. Native cloud document?           → native-api
2. Operation reasonably local?      → local
3. Needs OCR / conversion / heavy?  → remote
4. Local failed on resource limit?  → remote fallback,
                                      only if policy.allowRemote === true
```

## Privacy / local-only

A user policy of `execution: "local-only"` forbids any hidden backend fallback. If an operation cannot be performed locally, Content Engine returns a structured error:

```text
cannot_process_locally
```

It never uploads the document to a server on its own.

## Remote fallback

Remote fallback is opt-in through policy. `allowRemote: false` (or `execution: "local-only"`) disables it entirely. A remote fallback is only considered after a local processor fails for a resource constraint — never preemptively just because a file is large.

## Cloud-native document APIs

Documents whose `format` is a cloud-native type (`google_sheet`, `google_doc`, `google_slides`, …) route to `native-api` so they stay in their provider's object model instead of degrading into an XLSX/DOCX/PPTX round-trip.

## Per-operation routing

Routing runs **per operation**, not per document. The same `DocumentRef` may be inspected locally, then OCR'd remotely, then saved through its native API. `DocumentRef` therefore never carries an execution decision — target belongs to the operation.

## Document complexity

`DocumentComplexity` is an optional evidence bundle the router reads: file size, expanded size, pages/sheets/rows/columns/slides, image count, scanned/encrypted flags, text-layer presence, formula count, format. **File size is only one factor** — a 180 MB workbook read of a single "Summary" sheet can stay local, while an `extract` over all 850 000 rows goes remote.

## Device capabilities

`DeviceCapabilities` lets routing account for the concrete phone: platform, available/total memory, CPU cores, low-memory flag, background execution, network availability, metered network, charging state. The app's existing device-capability infrastructure will supply these values; nothing is benchmarked in this scaffold.

## Long-running jobs

Remote processing is modelled as jobs (`RemoteDocumentJob`) so a 200-page OCR, large-workbook analysis, or DOCX/PPTX → PDF conversion can outlive a single request/response:

```text
upload/reference document → create job → jobId → poll/websocket/push → result
```

No endpoints or polling are implemented yet — the contract only reserves the shape.

## Routing cases

| Document | Operation | Target |
| --- | --- | --- |
| `questions.xlsx` (850 KB) | read sheet "вопросы" | `local` |
| `financial-model.xlsx` (180 MB) | analyze entire workbook | `remote` |
| `financial-model.xlsx` (180 MB) | read sheet "Summary" | `local` (targeted read stays local) |
| format `google_sheet` | any operation | `native-api` |
| PDF, `hasTextLayer: false`, `requiresOcr` | read/search | `remote` |
| PDF (2 MB), `hasTextLayer: true` | search text | `local` |
| `.doc` | convert → docx | `remote` |
| `policy.execution = "local-only"`, large PDF | full analysis | `cannot_process_locally` |

## Binary contract

The base binary representation is `BinaryDocument { bytes: Uint8Array }` — identical across React Native/Hermes, browsers, Node backends and Web Workers. Node-specific `Buffer` may only appear inside a concrete adapter/processor, never in these contracts.

## Non-goals of this PR

- No file parsing.
- No Google API calls.
- No Android file access.
- No MCP tool registration.
- No document-processing library dependencies (SheetJS, PDF/DOCX/PPTX libs, etc.).
- No backend endpoints or HTTP clients.
- No changes to existing connectors (e.g. `connector-google` is integrated later via adapters, not imported here).
