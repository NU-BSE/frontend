# @mobile-agent/content-engine

Local-first Document/Content Engine for Creepy.IM — reads, indexes, analyzes, edits and creates documents **on the device**, without sending document, mail, message or other private content to the Creepy.IM backend or to third-party AI APIs.

This package is currently an **architecture scaffold**: it fixes the interfaces, the privacy invariants, the routing layer and the directory structure so that real parsers, native modules and OCR can be added later without changing the agent-facing API.

## Non-negotiable privacy invariant

```text
CONFIDENTIAL USER DATA
        │
        ▼
      DEVICE
        │
        ├── Local JS / TypeScript processing
        ├── Local native processing (Kotlin / Swift / C++ as needed)
        ├── Local indexing / search
        └── Local LLM
```

Forbidden:

```text
Document / Gmail / Telegram / Drive content
        ↓
creepy.im backend
        ↓
OpenRouter / external AI / external OCR
```

A document may physically live in Google Drive, Telegram, OneDrive, Dropbox, etc. The app may talk **directly to the user's chosen provider** to download/save the user's own file. That is transport/storage, never processing. Connectors are sources/sinks, not a compute backend.

If a task ever comes up as "the phone can't handle it — just send the document to the backend", the architecture's answer is:

```text
No remote-processing route.
```

Instead: targeted read, streaming, native processing, local indexing, lower-memory strategy, batch processing, user-selected scope, or `unsupported-on-this-device`.

---

# Three different concepts (do not conflate)

### Data source — where the document lives

```ts
type ContentSource =
  | "local" | "google-drive" | "google-sheets" | "google-docs" | "google-slides"
  | "telegram" | "onedrive" | "dropbox" | "generated";
```

### Processing runtime — where the document is parsed

```ts
type LocalExecutionTarget = "js" | "native";
```

Local only. There is no remote target.

### Model runtime — where the LLM gets context

```ts
type ModelRuntime = "local" | "cloud";
```

Private content (`user-private` / `sensitive`) is **always** `local`, no fallback. `credential` never becomes prompt context at all.

---

# Architecture

```text
                     USER
                       │
                       ▼
                  LLM / AGENT
                   local model
                       │
                       ▼
                 MCP DOCUMENT API
                       │
                       ▼
                  DocumentEngine
                       │
                       ▼
              DocumentOrchestrator
                       │
         ┌─────────────┴─────────────┐
         │                           │
         ▼                           ▼
     Source Layer               Format Layer
         │                           │
  Drive / Local / etc.       XLSX / DOCX / PDF
         │                           │
         └─────────────┬─────────────┘
                       │
                       ▼
             LocalExecutionRouter
                  /             \
                 ▼               ▼
           JS Processor     Native Processor
                 │               │
                 └───────┬───────┘
                         ▼
                Canonical Chunks
                         │
                         ▼
              Local Index / Retrieval
                         │
                         ▼
                     Local LLM
                         │
                         ▼
                  DocumentPatch
                         │
                         ▼
                   Format Adapter
                         │
                         ▼
                   Source Adapter
```

The LLM never learns which library opens XLSX, which XML lives inside DOCX, or which Kotlin class extracts PDF text. It only sees a small set of task-oriented tools.

---

# Agent-facing API

```text
document.find
document.inspect
document.read
document.search
document.extract
document.create
document.update
document.convert
document.save
```

No `read_xlsx`, `parse_pdf_native`, `edit_excel_with_sheetjs`, and no `readLocal` / `readRemote` / `readGoogle` — execution location is an implementation detail.

```ts
await document.read({
  document,
  selector: { kind: "spreadsheet", sheet: "вопросы", range: "A1:G200" },
});
```

---

# Execution layer (local only)

The execution layer decides **which on-device engine** does the work:

```ts
export type LocalExecutionTarget = "js" | "native";

export interface LocalExecutionPlan {
  target: LocalExecutionTarget;
  reason:
    | "lightweight-structured-format"
    | "native-format-support"
    | "memory-risk"
    | "requires-ocr"
    | "requires-native-pdf"
    | "large-archive"
    | "unsupported-in-js";
  strategy?: "full" | "targeted" | "streaming" | "indexed";
}

export interface LocalExecutionRouter {
  plan(context: LocalProcessingContext): Promise<LocalExecutionPlan>;
}
```

If neither the JS nor the native processor can handle a task, the engine returns `LOCAL_PROCESSING_UNSUPPORTED`. There is no cloud fallback.

Routing is **per operation**, never per document, and never based on file size alone. It weighs `DocumentComplexity`, `DeviceCapabilities`, the requested operation and its selector.

## JS first

TXT, JSON, Markdown, small/medium CSV, small/medium XLS/XLSX, simple DOCX semantic read, simple PDF modification (pdf-lib), basic OOXML inspection.

## Native first / native fallback

Large OOXML archives, large spreadsheets, PDF text extraction and rendering, scanned PDF, OCR, large image-heavy DOCX, high-memory operations, streaming OOXML. This is not a security fallback — both paths stay on device.

---

# Progressive processing (mandatory)

Never `open file → parse everything → huge CanonicalDocument → send everything to the model`. Always:

```text
inspect → identify relevant section → targeted read → local retrieval → LLM
```

- **Spreadsheet** — read workbook metadata → sheet names → read only the needed sheet/rows.
- **DOCX** — inspect headings/tables → find target heading → read selected paragraphs/table.
- **PDF** — page metadata/local index → search → read pages 37–41.
- **PPTX** — slide titles → find relevant slides → read selected slide XML.

If the device cannot run a full request, the engine proposes targeted processing rather than uploading: selected sheets, a page range, matching sections, text without embedded images.

## Chunk model

The primary unit is `DocumentChunk`, not one giant document object:

```ts
export interface DocumentChunk {
  documentId: string;
  chunkId: string;
  kind: "text" | "paragraph" | "table" | "sheet-range" | "slide" | "page" | "image-text";
  text?: string;
  structured?: unknown;
  location: DocumentLocation;       // required
  classification: DataClassification;
  nextCursor?: string;
}
```

Every chunk carries a stable `location` (sheet/range, paragraphId/headingPath, page, slide/shapeId) so the model can refer back to it for a targeted edit.

---

# Local index

Large documents must not be re-parsed on every operation. A future implementation uses `expo-sqlite` (app-private) with FTS5 so "cetane number" / "вопросы" / "срок поставки" can be found locally, without the LLM and without any cloud service. Semantic/vector retrieval (local embeddings + `sqlite-vec`) is out of scope until lexical retrieval works.

Indexed document bytes, OCR output, chunks and generated summaries are private data and must not be logged.

---

# Privacy layer

```text
privacy/
├── data-classification.ts      DataClassification, classifySource/Document
├── data-boundary-policy.ts     DataBoundaryPolicy (invariants)
├── context-provenance.ts       ContentProvenance
├── privacy-errors.ts           PrivacyError
└── model-context.ts            ModelContextEnvelope, routeModel
```

```ts
type DataClassification = "public" | "user-private" | "sensitive" | "credential";

interface DataBoundaryPolicy {
  localProcessingOnly: true;               // invariant
  allowProviderTransport: boolean;
  allowFirstPartyProcessingUpload: false;  // invariant
  allowThirdPartyAi: false;                // invariant
}
```

Everything from local filesystem, Drive, Gmail, Calendar, Contacts, Telegram, WhatsApp, OneDrive, Dropbox or a private connector defaults to `user-private`.

The model-routing seam prevents private text from accidentally reaching a cloud LLM:

```ts
interface ModelContextEnvelope {
  text: string;
  classification: DataClassification;
  provenance: readonly ContentProvenance[];
}

routeModel("user-private") === "local";
routeModel("sensitive")   === "local";
routeModel("public")      === "cloud";
isPromptAllowed("credential") === false;
```

---

# Binary + write contracts

Binary boundary is `Uint8Array`, never Node `Buffer` in core contracts:

```ts
interface BinaryDocument { bytes: Uint8Array; fileName?: string; mimeType?: string; }
```

Writes are **patches**, never full regeneration, so formatting/styles/formulas/charts survive. The safe workflow is:

```text
original → working copy → apply patch → validate → re-open → verify mutation → persist
```

`PersistOptions.mode` is `"new-revision"` (default) or `"replace"`; the original is never overwritten before validation.

## Adapters

- **Source adapter** (`DocumentSourceAdapter`) — where the document lives, how to `readBinary`/`writeBinary`. Knows nothing about XLSX/DOCX.
- **Format adapter** (`DocumentFormatAdapter`) — how the document is structured: `detect`, `capabilities`, `inspect`, `read`, `search?`, `applyPatch?`, `validate?`.
- **Execution router** — a third, separate layer.

Format detection never trusts extension alone: extension + MIME + magic bytes + container inspection. Conflicts yield `FORMAT_MISMATCH`.

Encrypted/password documents surface `DOCUMENT_PASSWORD_REQUIRED` / `ENCRYPTED_DOCUMENT_UNSUPPORTED`; the password never reaches the LLM or logs.

---

# Tool stack (phased — do not install everything now)

Install a dependency together with the adapter that actually uses it.

- **Phase A (core):** `expo-file-system`, `expo-document-picker`, `expo-sqlite`, `expo-secure-store`, `jszip`, `fast-xml-parser`.
- **Phase B (spreadsheet):** SheetJS CE (vendored tarball), `papaparse`.
- **Phase C (word):** `mammoth` (read), `docx` (create/template patch), JSZip + OOXML for arbitrary edit.
- **Phase D (PDF):** `pdf-lib` + `@pdf-lib/fontkit` (create/modify); native PDF text extraction (PDFBox-Android behind an abstraction); Android `PdfRenderer` for OCR rendering.
- **Phase E (presentation):** `pptxgenjs` after a Hermes/Metro spike; JSZip + OOXML for read/edit.
- **Phase F (structured text):** `unified`/`remark` only if AST editing is really needed.

OCR is on-device only (ML Kit Text Recognition v2, bundled model) — never Google Cloud Vision / Azure / AWS Textract.

---

# Adapter conformance tests

Every format adapter must pass the same suite: detect, inspect, targeted read, search, roundtrip (where supported), patch (where supported), validation, bad input, encrypted input, large-input guard. Synthetic fixtures only (simple.xlsx, formulas.xlsx, …, utf8.csv, quoted.csv); never real user documents.

Architecture tests also guard the invariants: `routeModel` never returns a cloud path for private content, and the package has no cloud-AI / backend-processing dependency.

---

# Milestones

1. **TXT/Markdown** — picker → local source → text adapter → inspect/read/search → local model.
2. **XLSX** — sheet list → targeted range read → search → set_cell patch → validate → save.
3. **DOCX** — semantic inspect/read → targeted paragraph/table retrieval → simple OOXML patch.
4. **PDF** — metadata → native text extraction → page search/index → on-device OCR fallback.
5. **PPTX** — slide inspect → targeted read → simple text patch.

---

# Definition of Done (architecture)

- Documents can be read without backend processing.
- Private content never leaves the device for AI processing.
- Connectors are sources/sinks, not compute backends.
- There are JS and native local processing tiers.
- Large documents are read targeted/chunked.
- `Uint8Array` is the binary boundary; every chunk has a location.
- Local FTS search needs no LLM; the local model receives only relevant chunks.
- Cloud model fallback is blocked for private content.
- Writes go through patches; output is validated before persistence.
- Heavy operations do not block the UI thread; OCR is on-device.
- Production logs never contain user document content.
- The MCP API stays format-agnostic; a new adapter can be added without changing the LLM tool surface.
