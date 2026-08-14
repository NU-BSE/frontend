# @mobile-agent/content-engine

Architecture scaffold for task-oriented reading, searching, extracting, creating and editing of documents and other file-backed content.

This package is intentionally **contract-only** in this PR. It defines boundaries, types and adapter slots, but contains no parser, writer, network client, storage implementation or MCP registration logic yet.

## Goals

- Give the agent a small, format-agnostic document API instead of format-specific tools such as `read_xlsx` or `edit_docx`.
- Separate where content lives (source adapters) from how a format is interpreted (format adapters).
- Preserve native document semantics during writes by applying patches through the native format adapter instead of round-tripping every document through plain text.
- Support inspection and bounded/chunked reads before loading large documents into model context.
- Keep stable location references for sheets/cells, pages, paragraphs, slides and other editable regions.
- Validate mutations before persistence and leave room for revisions/versioning.

## Intended flow

```text
Agent / MCP tools
      |
      v
DocumentEngine
      |
      v
DocumentOrchestrator
   /           \
  v             v
SourceAdapter  FormatAdapter
  |             |
Drive/local    XLSX/DOCX/PDF/...
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

The engine selects source and format adapters internally.

## Source adapters

Scaffolded slots exist for Google Drive, Google Sheets, Google Docs, Google Slides, local device files, backend files, Telegram and OneDrive.

Cloud-native documents should use their native APIs where possible. For example, Google Sheets should eventually use the Sheets API rather than export to XLSX for every operation.

## Format adapters

Scaffolded slots exist for XLS/XLSX, CSV, DOCX, PDF, PPTX, text, Markdown, HTML, JSON and images.

## Write model

Writes are represented as targeted patch operations. A future XLSX adapter should update the existing workbook so formulas/styles/charts are preserved; a future DOCX adapter should modify the existing package rather than regenerate it from extracted text.

## Non-goals of this PR

- No file parsing.
- No Google API calls.
- No Android file access.
- No MCP tool registration.
- No dependencies such as SheetJS, PDF libraries or DOCX libraries.
- No changes to existing connectors.
