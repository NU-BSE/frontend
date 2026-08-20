/**
 * Where a document operation is executed.
 *
 * Both targets are local to the device — there is **no remote processing
 * route**. The choice is only about which on-device engine does the work:
 *
 * - `js`     — pure TypeScript/JS (TXT, JSON, Markdown, small/medium
 *              CSV/XLSX/DOCX, simple PDF modification, basic OOXML).
 * - `native` — a local native module (Kotlin/Swift) for large OOXML archives,
 *              PDF text extraction/rendering, OCR, streaming and other
 *              high-memory work.
 *
 * The LLM never learns this value: it is an internal implementation detail of
 * the engine.
 */
export type LocalExecutionTarget = 'js' | 'native';
