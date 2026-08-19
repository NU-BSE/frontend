# LOCAL DOCUMENT ENGINE FOR CREEPY.IM
## Инструкция для coding-agent и руководство по архитектуре локальной обработки документов

**Цель:** построить в `NU-BSE/frontend` локальный Document/Content Engine, который читает, индексирует, анализирует, изменяет и создаёт документы **на устройстве пользователя**, не отправляя содержимое документов, писем, сообщений или другой приватной информации на backend creepy.im или в сторонние AI API.

> Этот документ одновременно:
> 1. является инструкцией для coding-agent;
> 2. фиксирует архитектурные решения;
> 3. объясняет разработчику, как самому дальше реализовывать адаптеры и native-часть.

---

# 1. Неподвижный privacy-инвариант

Главное правило системы:

```text
CONFIDENTIAL USER DATA
        │
        ▼
      DEVICE
        │
        ├── Local JS / TypeScript processing
        ├── Local native processing (Kotlin / Swift / C++ при необходимости)
        ├── Local indexing / search
        └── Local LLM
```

Запрещённая схема:

```text
Document / Gmail / Telegram / Drive content
        ↓
creepy.im backend
        ↓
OpenRouter / external AI / external OCR
```

Документы могут физически находиться в Google Drive, Telegram, OneDrive и т. п. В таком случае приложение имеет право обращаться **напрямую к выбранному пользователем провайдеру**, чтобы скачать или сохранить принадлежащий пользователю файл.

Это transport/storage, а не processing.

Правильная схема:

```text
Google Drive
     │
     │ authenticated provider API
     ▼
   DEVICE
     │
     ├── parse locally
     ├── search locally
     ├── reason locally
     ├── edit locally
     └── produce output locally
     │
     ▼
Google Drive
```

Нельзя использовать Google Drive, Dropbox, OneDrive и т. п. как промежуточный вычислительный backend.

---

# 2. Что должен сделать coding-agent

Работать в репозитории:

```text
https://github.com/NU-BSE/frontend
```

В проекте уже заложен пакет:

```text
packages/content-engine
```

Перед изменениями coding-agent обязан:

1. Просмотреть текущее состояние `packages/content-engine`.
2. Просмотреть существующие `connector-*`, `mcp-server`, local model routing и native-модули.
3. Не предполагать, что архитектура из этого документа уже полностью совпадает с кодом.
4. Если ранее был добавлен `RemoteDocumentProcessor`, backend document source или другой remote-processing scaffold — удалить/переработать его.
5. Не ломать существующие connectors и MCP API.

На первом PR не требуется реализовывать все форматы полностью. Сначала нужно привести архитектуру к описанной ниже модели и подготовить interfaces, routing, privacy contracts, test fixtures и первый минимальный end-to-end формат.

---

# 3. Не путать три разных понятия

Это принципиально.

## 3.1 Data source

Откуда берётся документ:

```ts
type DocumentSource =
  | "local"
  | "google-drive"
  | "google-sheets"
  | "google-docs"
  | "google-slides"
  | "telegram"
  | "onedrive"
  | "dropbox"
  | "generated";
```

## 3.2 Processing runtime

Где разбирается документ:

```ts
type LocalProcessingRuntime =
  | "js"
  | "native";
```

Только локально.

## 3.3 Model runtime

Где LLM получает контекст:

```ts
type ModelRuntime =
  | "local"
  | "cloud";
```

Для приватного контента:

```text
ModelRuntime = local
```

без fallback.

---

# 4. Архитектура верхнего уровня

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

Ключевой принцип:

**LLM не должен знать**, какая библиотека открывает XLSX, какой XML-файл лежит внутри DOCX и какой Kotlin-класс извлекает текст из PDF.

LLM должен видеть небольшой набор task-oriented tools.

---

# 5. Agent-facing API

Сохранить высокий уровень:

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

Не добавлять:

```text
read_xlsx
read_docx
parse_pdf_native
parse_pdf_js
edit_excel_with_sheetjs
```

Это implementation details.

Пример:

```ts
await document.read({
  document,
  selector: {
    kind: "spreadsheet",
    sheet: "вопросы",
    range: "A1:G200"
  }
});
```

DocumentEngine сам решает:

```text
source
→ local bytes
→ format adapter
→ JS/native runtime
→ canonical chunk
```

---

# 6. Privacy contracts

Добавить отдельный слой:

```text
packages/content-engine/src/privacy/
```

Рекомендуемая структура:

```text
privacy/
├── index.ts
├── data-classification.ts
├── data-boundary-policy.ts
├── context-provenance.ts
└── privacy-errors.ts
```

## DataClassification

```ts
export type DataClassification =
  | "public"
  | "user-private"
  | "sensitive"
  | "credential";
```

По умолчанию считать `user-private` всё, что пришло из:

```text
local filesystem
Google Drive
Gmail
Calendar
Contacts
Telegram
WhatsApp
OneDrive
Dropbox
private connector
```

## DataBoundaryPolicy

```ts
export interface DataBoundaryPolicy {
  /**
   * User content must be processed on this device.
   */
  localProcessingOnly: true;

  /**
   * Connector APIs may transport data only between the device
   * and the user's chosen source provider.
   */
  allowProviderTransport: boolean;

  /**
   * User document content must not be uploaded to creepy.im
   * for processing.
   */
  allowFirstPartyProcessingUpload: false;

  /**
   * Private content must not be sent to external AI APIs.
   */
  allowThirdPartyAi: false;
}
```

Не делать эти два поля configurable в production:

```ts
allowFirstPartyProcessingUpload: false
allowThirdPartyAi: false
```

Для Content Engine это invariant.

---

# 7. Интеграция с model routing

Это необходимо, иначе документы будут локально распарсены, но затем их текст может случайно уйти в cloud LLM.

Добавить seam между Content Engine и существующим AI router.

Пример:

```ts
export interface ModelContextEnvelope {
  text: string;
  classification: DataClassification;
  provenance: readonly ContentProvenance[];
}
```

Policy:

```ts
if (
  context.classification === "user-private" ||
  context.classification === "sensitive"
) {
  return LOCAL_MODEL_ONLY;
}
```

`credential` вообще не должен становиться prompt context.

Пример:

```text
OAuth access token
refresh token
API key
cookie
private key
```

не попадают в LLM независимо от того, локальная модель или cloud.

---

# 8. Основной binary contract

В core нельзя использовать Node.js `Buffer`.

Использовать:

```ts
export interface BinaryDocument {
  bytes: Uint8Array;
  fileName?: string;
  mimeType?: string;
}
```

Почему это важно:

```text
Hermes / React Native
Browser
Kotlin bridge
Native ArrayBuffer
Node в tooling/tests
```

могут работать через `Uint8Array`/`ArrayBuffer`.

`Buffer` допускается только внутри Node-specific tests/tooling.

---

# 9. Source adapters

Source adapter отвечает только за:

```text
resolve
read/download
write/upload
metadata
revision
delete/move при необходимости
```

Он не знает, как устроен XLSX или DOCX.

Интерфейс:

```ts
export interface DocumentSourceAdapter {
  readonly id: string;

  supports(ref: DocumentRef): boolean;

  resolve(ref: DocumentRef): Promise<DocumentRef>;

  readBinary(ref: DocumentRef): Promise<BinaryDocument>;

  writeBinary?(
    ref: DocumentRef,
    binary: BinaryDocument,
    options?: PersistOptions,
  ): Promise<DocumentRef>;
}
```

Для Google Sheets/Docs/Slides может быть отдельный structured source API, потому что эти документы не обязательно экспортировать в Office format.

Важно:

```text
GoogleDriveSourceAdapter
```

не должен содержать XLSX parser.

---

# 10. Local execution layer

Создать:

```text
packages/content-engine/src/execution/
```

Структура:

```text
execution/
├── index.ts
├── local-execution-router.ts
├── processing-context.ts
├── document-complexity.ts
├── execution-target.ts
├── local-js-processor.ts
├── local-native-processor.ts
├── processor-registry.ts
└── errors.ts
```

## Target

```ts
export type LocalExecutionTarget =
  | "js"
  | "native";
```

**Не добавлять `remote`.**

## Router

```ts
export interface LocalExecutionRouter {
  plan(context: LocalProcessingContext): Promise<LocalExecutionPlan>;
}
```

```ts
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
```

Если ни JS, ни native processor не умеют задачу:

```text
LOCAL_PROCESSING_UNSUPPORTED
```

Никакого fallback в cloud.

---

# 11. Document complexity

Router не должен смотреть только на размер файла.

```ts
export interface DocumentComplexity {
  fileSize?: number;
  estimatedExpandedSize?: number;

  pages?: number;
  sheets?: number;
  rows?: number;
  columns?: number;
  slides?: number;

  archiveEntries?: number;
  images?: number;

  encrypted?: boolean;
  scanned?: boolean;
  hasTextLayer?: boolean;

  formulaCount?: number;

  metadata?: Readonly<Record<string, unknown>>;
}
```

Один и тот же файл может иметь разные execution plans для разных операций.

Пример:

```text
180 MB XLSX
```

Запрос:

```text
inspect workbook structure
```

может быть выполнен targeted/native.

Запрос:

```text
materialize every cell into JS objects
```

может быть запрещён по memory policy.

---

# 12. Progressive processing — обязательный принцип

Нельзя строить архитектуру:

```text
open file
→ parse everything
→ create huge CanonicalDocument
→ send everything to local model
```

Нужно:

```text
inspect
→ identify relevant section
→ targeted read
→ local retrieval
→ LLM
```

## Spreadsheet

```text
workbook
  ↓
read workbook metadata
  ↓
sheet names
  ↓
user asks about "вопросы"
  ↓
read only that sheet / needed rows
```

## DOCX

```text
docx
 ↓
inspect headings / tables
 ↓
find target heading
 ↓
read selected paragraphs/table
```

## PDF

```text
PDF
 ↓
page metadata / local index
 ↓
search
 ↓
read pages 37-41
```

## PPTX

```text
PPTX
 ↓
slide titles
 ↓
find relevant slides
 ↓
read selected slide XML
```

---

# 13. Chunk model

Не использовать один огромный `CanonicalDocument` как обязательный intermediate representation.

Основная единица:

```ts
export interface DocumentChunk {
  documentId: string;
  chunkId: string;

  kind:
    | "text"
    | "paragraph"
    | "table"
    | "sheet-range"
    | "slide"
    | "page"
    | "image-text";

  text?: string;
  structured?: unknown;

  location: DocumentLocation;

  classification: DataClassification;

  nextCursor?: string;
}
```

Location обязателен.

Например XLSX:

```json
{
  "sheet": "вопросы",
  "range": "A50:F75"
}
```

DOCX:

```json
{
  "paragraphId": "p-58",
  "headingPath": ["3. Требования", "3.2 Материалы"]
}
```

PDF:

```json
{
  "page": 42
}
```

PPTX:

```json
{
  "slide": 8,
  "shapeId": "shape-13"
}
```

---

# 14. Локальный индекс

Для больших документов агент не должен каждый раз заново парсить весь файл.

Использовать `expo-sqlite`.

Рекомендуемая схема:

```text
documents
chunks
locations
fts_chunks
document_revisions
processing_cache
```

Пример:

```sql
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  source_id TEXT,
  revision TEXT,
  name TEXT,
  format TEXT,
  indexed_at INTEGER
);

CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  kind TEXT NOT NULL,
  text TEXT,
  location_json TEXT NOT NULL
);
```

FTS:

```text
SQLite FTS5
```

позволяет локально искать:

```text
"cetane number"
"вопросы"
"срок поставки"
```

без LLM и без cloud.

В дальнейшем, если действительно нужен semantic retrieval, можно рассмотреть локальный embedding model + `sqlite-vec`.

Не внедрять embeddings до работающего lexical/structured retrieval.

---

# 15. Локальное хранение и security

Для документов использовать app-private storage.

Для ключей/маленьких секретов:

```text
expo-secure-store
```

Не хранить большие документы в SecureStore.

Если локальный индекс содержит приватный текст, предусмотреть SQLCipher для SQLite.

Важно:

```text
Document bytes
OCR output
index chunks
generated summaries
```

считать приватными данными.

Не логировать содержимое документов через:

```ts
console.log(chunk.text)
```

в production.

Добавить redacted telemetry contract.

---

# 16. Tool stack: базовый слой

Ниже приведён рекомендуемый стек. Не требуется устанавливать всё в одном PR. Устанавливать пакет вместе с адаптером, который реально его использует.

## Expo / device I/O

```bash
npx expo install expo-file-system
npx expo install expo-document-picker
npx expo install expo-sqlite
npx expo install expo-secure-store
npx expo install expo-image-manipulator
```

Назначение:

- `expo-file-system` — локальное чтение/запись файлов.
- `expo-document-picker` — выбор локального документа через системный UI.
- `expo-sqlite` — локальный индекс, FTS, cache, revisions metadata.
- `expo-secure-store` — ключи/секреты, но не сами документы.
- `expo-image-manipulator` — локальная подготовка изображений перед OCR.

---

# 17. Tool stack: ZIP + XML foundation

Современные:

```text
.docx
.xlsx
.pptx
```

являются OOXML ZIP containers.

Базовые инструменты:

```bash
npm install jszip fast-xml-parser
```

`JSZip`:

```text
ZIP ↔ Uint8Array
```

`fast-xml-parser`:

```text
XML ↔ JS objects
```

Это universal escape hatch для Office Open XML.

Но:

**для больших файлов JSZip не должен быть единственным способом.**

Для large OOXML позже сделать native streaming implementation:

```text
Kotlin
java.util.zip.ZipFile
XmlPullParser / streaming XML
```

чтобы не распаковывать весь архив в JS heap.

---

# 18. XLS / XLSX adapter

Основной high-level parser:

```text
SheetJS Community Edition
```

Устанавливать с официального tarball, а не полагаться на устаревший npm registry package:

```bash
npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
```

Лучше затем vendoring:

```text
vendor/xlsx-0.20.3.tgz
```

и dependency через local file.

## Использовать SheetJS для

```text
workbook metadata
sheet names
cell values
formulas as stored expressions
basic read
basic write
XLS
XLSX
CSV-like spreadsheet conversion
```

## Не считать, что SheetJS автоматически решает

```text
full Excel rendering fidelity
all charts
all advanced formatting preservation
Excel-compatible formula recalculation
macros
arbitrary OOXML features
```

## Preservation mode

Для targeted edit существующего XLSX:

```text
read ZIP
→ modify minimum XML entries
→ preserve untouched archive entries
→ repack
```

не:

```text
parse workbook
→ generate brand new workbook
```

если пользователь ожидает сохранение сложного исходного оформления.

## Formula calculation

Запись формулы ≠ пересчёт формулы.

Если потребуется локальный calculation engine, отдельно оценить:

```bash
npm install hyperformula
```

Но до использования обязательно проверить лицензию проекта: HyperFormula использует GPLv3 или коммерческую лицензию.

Не добавлять его автоматически без product/license decision.

---

# 19. CSV / TSV

Для небольших файлов можно реализовать самостоятельно.

Для полноценного parser:

```bash
npm install papaparse
```

Нужно поддержать streaming/chunked parsing, потому что CSV может быть большим.

CSV adapter должен уметь:

```text
inspect columns
read rows window
search rows
append/update when feasible
stream
```

---

# 20. DOCX adapter

Для semantic read:

```bash
npm install mammoth
```

Mammoth хорошо подходит для извлечения:

```text
headings
paragraphs
lists
tables
images
comments
links
raw text
```

Но Mammoth специально ориентируется на семантику, а не на pixel-perfect Word formatting.

Поэтому:

```text
Mammoth = read/extract
```

не считать универсальным editor.

## DOCX create/template patch

```bash
npm install docx
```

Библиотека `docx` подходит для создания DOCX и template placeholder patching.

## Arbitrary existing DOCX editing

Использовать:

```text
JSZip
+
fast-xml-parser
```

и минимальные OOXML patches.

Пример:

```text
word/document.xml
word/styles.xml
word/_rels/document.xml.rels
word/comments.xml
```

Не переписывать неизвестные части документа.

---

# 21. PDF adapter

PDF разделить на три задачи:

## 21.1 Create / modify

```bash
npm install pdf-lib @pdf-lib/fontkit
```

`pdf-lib` официально тестируется в React Native и работает с `Uint8Array`.

Использовать для:

```text
create PDF
add/remove/copy pages
draw text
draw images
forms
metadata
attachments
simple modifications
```

## 21.2 Text extraction

Не строить ключевой PDF text extraction вокруг browser-only PDF.js в React Native.

Для Android local-native tier использовать native PDF engine.

Кандидат:

```gradle
implementation("com.tom-roush:pdfbox-android:2.0.27.0")
```

Перед production adoption:
- прогнать compatibility tests;
- проверить performance;
- проверить release/R8;
- проверить encrypted PDFs;
- проверить fonts;
- проверить maintenance risk.

Скрыть библиотеку за собственным `NativePdfAdapter`, чтобы её можно было заменить.

## 21.3 Rendering for OCR

Android `PdfRenderer` умеет локально рендерить страницу PDF в bitmap.

Flow:

```text
PDF page
→ PdfRenderer
→ Bitmap
→ on-device OCR
```

---

# 22. OCR полностью на устройстве

Для Android использовать ML Kit Text Recognition v2.

Для максимальной privacy/offline predictability выбирать **bundled model**, а не вариант, который скачивается при первом использовании.

Пример Gradle dependency для Latin text:

```gradle
implementation("com.google.mlkit:text-recognition:<current-version>")
```

Не фиксировать версию из этого документа — coding-agent должен проверить актуальную официальную документацию перед внедрением.

ML Kit возвращает:

```text
blocks
lines
elements
bounding boxes
confidence/location information
```

OCR pipeline:

```text
Image / scanned PDF page
        ↓
normalize image locally
        ↓
ML Kit bundled OCR
        ↓
OCR blocks
        ↓
DocumentChunk[]
        ↓
SQLite local index
```

Никаких Google Cloud Vision, Azure OCR, AWS Textract и т. п.

---

# 23. PPTX adapter

Для создания новой презентации можно рассмотреть:

```bash
npm install pptxgenjs
```

Но перед использованием в React Native проверить Metro/Hermes compatibility в отдельном spike.

Для чтения и targeted edit существующего PPTX основной надёжный фундамент:

```text
JSZip
+
OOXML
+
fast-xml-parser
```

Ключевые части:

```text
ppt/presentation.xml
ppt/slides/slideN.xml
ppt/slides/_rels/
ppt/notesSlides/
ppt/media/
ppt/theme/
```

Принцип тот же:

```text
preserve unknown entries
patch minimum XML
```

---

# 24. TXT / Markdown / JSON / HTML

## TXT

Никаких библиотек для UTF-8 не требуется:

```ts
TextDecoder
TextEncoder
```

Для legacy encodings при реальной необходимости:

```bash
npm install iconv-lite
```

Сначала проверить Hermes compatibility.

## JSON

Нативно:

```ts
JSON.parse
JSON.stringify
```

Для огромного JSON позже добавить streaming parser, если появится реальный use case.

## Markdown

Для plain read/write библиотека не нужна.

Для AST-based edit:

```bash
npm install unified remark-parse remark-stringify
```

## HTML

Для semantic parsing/editing выбрать HTML parser после Hermes compatibility spike.

Не привязывать contracts к конкретному HTML library.

---

# 25. Image adapter

Изображение не нужно превращать в большой generic JS object.

Adapter должен возвращать:

```ts
{
  width,
  height,
  mimeType,
  localUri,
  orientation
}
```

И только по запросу:

```text
OCR
resize
crop
rotate
extract metadata
```

Для preprocessing:

```text
expo-image-manipulator
```

OCR — ML Kit.

---

# 26. Native processing tier

JS подходит не для всего.

Планировать отдельный local native layer:

```text
LocalNativeDocumentProcessor
```

Использовать Expo Modules API или другой уже принятый в проекте modern native bridge.

Не складывать hand-written Kotlin в generated/ignored `android/` path без понимания текущей repo convention.

Native module должен возвращать не гигантские объекты, а chunked/targeted результаты.

Плохой bridge:

```ts
parseHugePdf(uri): Promise<Entire500PageJson>
```

Правильнее:

```ts
inspectPdf(uri)
readPdfPages(uri, from, to)
searchPdf(uri, query, cursor?)
renderPdfPage(uri, page, options)
```

То же для OOXML.

---

# 27. Native Android implementation tools

Для OOXML в Kotlin можно использовать стандартную платформу:

```text
java.util.zip.ZipFile
java.util.zip.ZipEntry
InputStream
OutputStream
XmlPullParser
XmlSerializer / XML writer
Kotlin coroutines
```

Это позволяет:

```text
open ZIP
→ list entries
→ stream one XML entry
→ parse needed nodes
```

без распаковки всего файла в память.

Для PDF:

```text
PdfRenderer
PdfBox-Android behind abstraction
```

Для OCR:

```text
ML Kit bundled text recognition
```

Для image operations:

```text
Bitmap APIs
```

---

# 28. Не выполнять тяжёлую работу на JS/UI thread

Все тяжёлые операции должны быть async и interruptible.

Нужны:

```ts
export interface ProcessingProgress {
  phase:
    | "opening"
    | "inspecting"
    | "reading"
    | "indexing"
    | "ocr"
    | "patching"
    | "validating"
    | "saving";

  completed?: number;
  total?: number;
}
```

И cancellation:

```ts
AbortSignal
```

или собственный cross-runtime cancellation token.

Native tier должен выполнять тяжёлую работу на worker/native thread.

---

# 29. Background processing

Не обещать, что обычный JS promise гарантированно доработает после сворачивания приложения.

Expo BackgroundTask использует системные schedulers и не является универсальным immediate long-running compute runtime.

Если понадобится:

```text
OCR 300 pages
local indexing for 1 GB corpus
long conversion
```

на Android проектировать foreground-service based native job с явным уведомлением пользователю.

Не внедрять это до реальной необходимости.

Первый вариант:
- держать приложение открытым;
- показывать progress;
- поддерживать cancel/resume checkpoints.

---

# 30. Write architecture

Чтение и запись должны быть асимметричны.

Для чтения можно нормализовать:

```text
native format
→ DocumentChunk[]
```

Для редактирования нельзя всегда делать:

```text
DocumentChunk[]
→ regenerate whole document
```

Потому что потеряются особенности исходного файла.

Нужен patch API.

```ts
export type DocumentPatchOperation =
  | SetCellOperation
  | SetRangeOperation
  | ReplaceTextOperation
  | InsertContentOperation
  | DeleteContentOperation
  | RenameSheetOperation
  | AddSheetOperation
  | ReplaceSlideTextOperation;
```

Пример:

```ts
{
  op: "set_cell",
  sheet: "Расчеты",
  cell: "B15",
  value: 32
}
```

Adapter сам решает, какой native representation изменить.

---

# 31. Safe write workflow

Любая модификация:

```text
original
  ↓
working copy
  ↓
apply patch
  ↓
validate
  ↓
re-open
  ↓
verify expected mutation
  ↓
persist
```

Не перезаписывать original до validation.

Рекомендуемый API:

```ts
interface PersistOptions {
  mode:
    | "new-revision"
    | "replace";

  expectedRevision?: string;
}
```

По умолчанию в early versions:

```text
new-revision
```

или temporary-copy → atomic replace.

---

# 32. Validation

Каждый adapter обязан иметь validator.

## XLSX

Проверять:

```text
ZIP opens
[Content_Types].xml exists
workbook relationship valid
target sheet exists
edited cell has expected value
critical original entries remain
```

## DOCX

```text
ZIP opens
word/document.xml exists
relationships parse
document re-opens through adapter
target patch is present
```

## PPTX

```text
presentation.xml exists
slide relationships valid
target slide parses
```

## PDF

```text
PDF engine opens output
page count expected
requested mutation exists where verifiable
```

---

# 33. Format detection

Не доверять только extension.

Pipeline:

```text
filename extension
+
mime type
+
magic bytes
+
container inspection
```

Для ZIP-based Office:

```text
open ZIP
→ [Content_Types].xml
→ identify XLSX / DOCX / PPTX
```

Если данные конфликтуют:

```text
FORMAT_MISMATCH
```

---

# 34. Encrypted / password-protected documents

Сразу добавить capability:

```ts
encrypted?: boolean
```

Если adapter не умеет расшифровать:

```text
DOCUMENT_PASSWORD_REQUIRED
```

или:

```text
ENCRYPTED_DOCUMENT_UNSUPPORTED
```

Не пытаться обходить защиту.

Пароль не должен попадать в LLM context или logs.

---

# 35. Capability registry

Каждый adapter декларирует, что реально умеет.

```ts
export interface DocumentCapabilities {
  inspect: boolean;
  read: boolean;
  search: boolean;
  extract: boolean;
  create: boolean;
  update: boolean;

  preservesFormattingOnUpdate: boolean;

  tables: boolean;
  images: boolean;
  formulas: boolean;
  sheets: boolean;
  slides: boolean;

  targetedRead: boolean;
  streamingRead: boolean;
  localIndexing: boolean;
}
```

Нельзя обещать агенту `update=true`, если адаптер умеет только генерировать новый файл.

---

# 36. Рекомендуемая структура пакета

```text
packages/content-engine/
├── README.md
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    │
    ├── contracts/
    │   ├── document-ref.ts
    │   ├── binary-document.ts
    │   ├── capabilities.ts
    │   ├── selectors.ts
    │   ├── locations.ts
    │   ├── chunks.ts
    │   ├── patches.ts
    │   ├── results.ts
    │   └── index.ts
    │
    ├── privacy/
    │   ├── data-classification.ts
    │   ├── data-boundary-policy.ts
    │   ├── context-provenance.ts
    │   ├── privacy-errors.ts
    │   └── index.ts
    │
    ├── core/
    │   ├── document-engine.ts
    │   ├── orchestrator.ts
    │   ├── capability-registry.ts
    │   ├── adapter-registry.ts
    │   ├── version-manager.ts
    │   └── index.ts
    │
    ├── execution/
    │   ├── execution-target.ts
    │   ├── processing-context.ts
    │   ├── document-complexity.ts
    │   ├── local-execution-router.ts
    │   ├── local-js-processor.ts
    │   ├── local-native-processor.ts
    │   ├── processor-registry.ts
    │   ├── errors.ts
    │   └── index.ts
    │
    ├── indexing/
    │   ├── document-index.ts
    │   ├── chunk-store.ts
    │   ├── fts-index.ts
    │   └── index.ts
    │
    ├── adapters/
    │   ├── formats/
    │   │   ├── xlsx/
    │   │   ├── csv/
    │   │   ├── docx/
    │   │   ├── pdf/
    │   │   ├── pptx/
    │   │   ├── text/
    │   │   ├── markdown/
    │   │   ├── json/
    │   │   ├── html/
    │   │   └── image/
    │   │
    │   └── sources/
    │       ├── local/
    │       ├── google-drive/
    │       ├── google-sheets/
    │       ├── google-docs/
    │       ├── google-slides/
    │       ├── telegram/
    │       └── onedrive/
    │
    ├── mcp/
    │   ├── tool-names.ts
    │   ├── tool-contracts.ts
    │   └── index.ts
    │
    └── testing/
        ├── fixtures.ts
        ├── conformance.ts
        └── index.ts
```

---

# 37. Adapter interface

```ts
export interface DocumentFormatAdapter {
  readonly id: string;

  detect(input: BinaryDocument): Promise<boolean>;

  capabilities(
    document: DocumentRef
  ): Promise<DocumentCapabilities>;

  inspect(
    document: DocumentRef,
    input: BinaryDocument,
  ): Promise<DocumentInspection>;

  read(
    document: DocumentRef,
    input: BinaryDocument,
    selector: DocumentSelector,
  ): Promise<DocumentReadResult>;

  search?(
    document: DocumentRef,
    input: BinaryDocument,
    query: string,
    cursor?: string,
  ): Promise<DocumentSearchResult>;

  applyPatch?(
    document: DocumentRef,
    input: BinaryDocument,
    patch: DocumentPatch,
  ): Promise<BinaryDocument>;

  validate?(
    input: BinaryDocument,
  ): Promise<DocumentValidationResult>;
}
```

Native adapters могут иметь другую internal implementation, но public semantics должны совпадать.

---

# 38. Local JS vs Local Native strategy

Начальный rule set:

## JS first

```text
TXT
JSON
Markdown
small/medium CSV
small/medium XLS/XLSX
simple DOCX semantic read
simple PDF modification via pdf-lib
basic OOXML inspection
```

## Native first / native fallback

```text
large OOXML archive
large spreadsheet
PDF text extraction
PDF rendering
scanned PDF
OCR
large image-heavy DOCX
high-memory operation
streaming OOXML
```

Это не security fallback — оба пути остаются на устройстве.

---

# 39. Memory discipline

Основная опасность local document processing — RAM.

Запрещать паттерн:

```ts
const bytes = readHugeFile();
const zip = await JSZip.loadAsync(bytes);
const allXml = await Promise.all(allEntries.map(...));
const giantObjects = allXml.map(parseXml);
```

Для больших файлов:

```text
targeted ZIP entry
stream
chunk
index
discard temporary representation
```

Нужно следить за:

```text
compressed bytes
expanded XML
JS object graph
image buffers
LLM context
index buffers
```

одновременно.

---

# 40. Что делать с большим документом вместо cloud fallback

Если устройство не может выполнить полный запрос:

1. Попробовать `inspect`.
2. Выбрать relevant section.
3. Предложить targeted processing.
4. Уменьшить image resolution для OCR.
5. Обрабатывать pages/sheets батчами.
6. Строить локальный индекс постепенно.
7. Сохранять checkpoint.
8. Если всё равно невозможно — вернуть понятную ошибку.

Например:

```text
This file is too large to analyze in one pass on this device.
I can analyze:
- selected sheets;
- a page range;
- matching sections;
- text without embedded images.
```

Но не загружать в cloud.

---

# 41. Connector architecture

Connector только получает данные.

Пример Google Drive:

```text
Google connector
     ↓
file metadata
     ↓
download to app-private local temp file
     ↓
Content Engine
```

После edit:

```text
Content Engine
     ↓
local validated output
     ↓
Google connector
     ↓
upload/revision
```

Не создавать:

```text
GoogleConnector.parseXlsx()
```

Google-native formats являются исключением по transport representation:

```text
Google Sheets API
→ structured values/metadata
```

Но reasoning всё равно local.

---

# 42. Google Sheets / Docs / Slides

Это cloud provider APIs, но не external processing.

Для Google Sheet:

```text
Sheets API
→ selected range JSON
→ device
→ local LLM
→ patch
→ device
→ Sheets API batchUpdate
```

Не обязательно экспортировать весь Sheet в XLSX.

Для privacy минимизировать transport:

```text
fetch only required ranges
```

когда это возможно.

---

# 43. Первый end-to-end milestone

Не пытаться сразу закончить 10 форматов.

Сделать вертикальный slice:

## Milestone 1 — TXT/Markdown

```text
DocumentPicker
→ LocalSourceAdapter
→ TextAdapter
→ inspect
→ read
→ search
→ local model context
```

## Milestone 2 — XLSX

```text
Drive/local
→ XlsxAdapter
→ sheet list
→ targeted sheet range read
→ search
→ set_cell patch
→ validate
→ save
```

## Milestone 3 — DOCX

```text
semantic inspect/read
→ targeted paragraph/table retrieval
→ placeholder/simple OOXML patch
```

## Milestone 4 — PDF

```text
metadata
→ native text extraction
→ page search/index
→ OCR fallback fully on-device
```

## Milestone 5 — PPTX

```text
slide inspect
→ targeted read
→ simple text patch
```

---

# 44. Package installation plan

Не ставить все зависимости заранее.

## Phase A: Core

```bash
npx expo install expo-file-system expo-document-picker expo-sqlite expo-secure-store
npm install jszip fast-xml-parser
```

## Phase B: Spreadsheet

```bash
npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
npm install papaparse
```

## Phase C: Word

```bash
npm install mammoth docx
```

## Phase D: PDF

```bash
npm install pdf-lib @pdf-lib/fontkit
```

+ native PDF module separately.

## Phase E: Presentation

```bash
npm install pptxgenjs
```

только после Hermes/Metro compatibility test.

## Phase F: Structured text

```bash
npm install unified remark-parse remark-stringify
```

если AST editing действительно нужен.

---

# 45. Tests должны быть adapter-conformance tests

Создать общий test suite.

Каждый format adapter должен пройти:

```text
detect
inspect
targeted read
search
roundtrip where supported
patch where supported
validation
bad input
encrypted/unsupported input
large input guard
```

Пример:

```ts
runAdapterConformanceSuite({
  adapter: new XlsxAdapter(),
  fixtures: xlsxFixtures,
});
```

---

# 46. Fixtures

Добавить маленькие test documents:

```text
simple.xlsx
formulas.xlsx
formatted.xlsx
merged-cells.xlsx

simple.docx
tables.docx
images.docx

simple.pdf
scanned-one-page.pdf

simple.pptx

utf8.csv
quoted.csv
```

Не коммитить реальные пользовательские документы.

Fixtures должны быть synthetic.

---

# 47. Performance tests

Минимум измерять:

```text
time to inspect
time to first chunk
peak-like memory indicator where possible
number of allocated chunks
indexing duration
```

Самый важный metric:

```text
time_to_first_useful_chunk
```

а не время полного parse.

---

# 48. Observability без утечки данных

Можно логировать:

```json
{
  "format": "xlsx",
  "sizeBucket": "10-50mb",
  "operation": "inspect",
  "runtime": "native",
  "durationMs": 482,
  "success": true
}
```

Нельзя логировать:

```json
{
  "fileName": "salary_amin.xlsx",
  "sheet": "employees",
  "query": "salary",
  "text": "...user content..."
}
```

По умолчанию telemetry redacted.

---

# 49. Error model

Ошибки должны быть machine-readable:

```ts
export type DocumentErrorCode =
  | "UNSUPPORTED_FORMAT"
  | "FORMAT_MISMATCH"
  | "CORRUPT_DOCUMENT"
  | "DOCUMENT_PASSWORD_REQUIRED"
  | "ENCRYPTED_DOCUMENT_UNSUPPORTED"
  | "LOCAL_PROCESSING_UNSUPPORTED"
  | "MEMORY_LIMIT"
  | "INVALID_SELECTOR"
  | "LOCATION_NOT_FOUND"
  | "PATCH_CONFLICT"
  | "REVISION_CONFLICT"
  | "VALIDATION_FAILED"
  | "SOURCE_READ_FAILED"
  | "SOURCE_WRITE_FAILED"
  | "NATIVE_PROCESSOR_UNAVAILABLE";
```

Не заставлять LLM угадывать проблему из human error string.

---

# 50. Что coding-agent НЕ должен делать

Запрещено:

- добавлять backend document processing;
- добавлять `RemoteDocumentProcessor`;
- отправлять документы на OpenRouter;
- отправлять extracted text на OpenRouter;
- использовать Google Cloud Vision OCR;
- использовать Azure/AWS OCR;
- отправлять документ в сторонний converter;
- создавать временные public URLs;
- логировать document content;
- использовать `Buffer` в core contracts;
- полностью materialize большие документы без необходимости;
- создавать отдельный MCP tool на каждый формат;
- смешивать connector и parser;
- обещать arbitrary editing там, где adapter этого не умеет;
- изменять оригинал без validation;
- добавлять форматы «для галочки» с fake implementation.

---

# 51. Что делать в ближайшем архитектурном PR

Coding-agent должен:

1. Привести `content-engine` к local-only philosophy.
2. Удалить remote-processing contracts, если они присутствуют.
3. Добавить `privacy/`.
4. Добавить `LocalExecutionTarget = js | native`.
5. Добавить `LocalExecutionRouter`.
6. Добавить `DocumentComplexity`.
7. Добавить `BinaryDocument` на `Uint8Array`.
8. Добавить chunk/location contracts.
9. Добавить indexing contracts.
10. Добавить local-native processor interface.
11. Добавить private-data/model-routing seam.
12. Обновить README.
13. Не добавлять реальных heavy parsers, если задача PR только архитектурная.
14. Добавить architecture tests/type tests.
15. Запустить typecheck.

---

# 52. Что делать в первом implementation PR

После architecture PR:

1. `LocalSourceAdapter`.
2. `TextAdapter`.
3. `CsvAdapter`.
4. `XlsxAdapter.inspect()`.
5. `XlsxAdapter.read()` с selector sheet/range.
6. `XlsxAdapter.search()`.
7. `XlsxAdapter.set_cell`.
8. Validation.
9. SQLite FTS index.
10. Подключить `document.inspect/read/search/update` к MCP.
11. Проверить, что private chunks никогда не попадают в cloud fallback.

---

# 53. Как самому писать новый adapter

Для каждого формата ответить на 8 вопросов:

## 1. Как определить формат?

```text
magic
mime
container metadata
```

## 2. Как дешёво inspect?

Не читая весь файл.

## 3. Как сделать targeted read?

```text
sheet
page
paragraph
slide
range
```

## 4. Как сделать search без LLM?

Structured search / FTS.

## 5. Какие locations стабильны?

Чтобы потом редактировать найденный фрагмент.

## 6. Как делать patch без уничтожения неизвестных данных?

Минимальная mutation.

## 7. Как валидировать output?

Повторно открыть и проверить.

## 8. Где выполнять?

```text
JS
или
native
```

Если ответы определены — adapter архитектурно готов к реализации.

---

# 54. Пример: как самому реализовать XlsxAdapter

## Шаг 1

Получить bytes:

```ts
const binary = await source.readBinary(ref);
```

## Шаг 2

Проверить ZIP/OOXML или XLS signature.

## Шаг 3

`inspect`:

```ts
const workbook = XLSX.read(binary.bytes, {
  type: "array",
});
```

Вернуть только:

```ts
{
  sheets: workbook.SheetNames
}
```

Не отправлять весь workbook выше.

## Шаг 4

`read`:

```ts
selector.sheet
selector.range
```

и вернуть ограниченный массив строк/cells.

## Шаг 5

Создать location:

```ts
{
  sheet: "вопросы",
  range: "A1:F100"
}
```

## Шаг 6

Для `set_cell`:

- basic mode: SheetJS mutation;
- preservation mode: OOXML targeted patch.

## Шаг 7

Serialize в `Uint8Array`.

## Шаг 8

Повторно открыть output.

## Шаг 9

Убедиться, что нужная ячейка изменилась.

## Шаг 10

Сохранить через SourceAdapter.

---

# 55. Пример: как самому реализовать DOCX

DOCX:

```text
ZIP
├── [Content_Types].xml
├── word/document.xml
├── word/styles.xml
├── word/_rels/
├── word/media/
└── ...
```

Read path:

```text
Mammoth
→ semantic chunks
```

Edit path:

```text
JSZip
→ specific XML
→ XML parser
→ patch node
→ serialize
→ replace entry
→ repack
```

Не пытаться использовать extracted plain text как canonical source для regenerated DOCX.

---

# 56. Пример: как самому реализовать PDF

PDF гораздо сложнее Office XML.

Разделить:

```text
PdfMetadataAdapter
PdfTextAdapter
PdfRenderAdapter
PdfMutationAdapter
PdfOcrAdapter
```

Публично это всё может скрываться за `PdfAdapter`.

Android native:

```text
PDFBox / platform API
```

Для scanned:

```text
render page
→ bitmap
→ ML Kit
→ chunks
```

Для modification:

```text
pdf-lib
```

если операция поддерживается без разрушения документа.

---

# 57. Пример: local RAG над документами

Не отправлять 100 страниц локальной модели сразу.

Pipeline:

```text
document
   ↓
parse locally
   ↓
chunks
   ↓
SQLite FTS
   ↓
query
   ↓
top relevant chunks
   ↓
local model
```

Phase 1:

```text
FTS5 only
```

Phase 2 при необходимости:

```text
local embeddings
+
sqlite-vec
```

Hybrid retrieval:

```text
FTS score
+
vector score
+
document structure
```

---

# 58. Privacy unit tests

Добавить tests, которые не дадут случайно вернуть cloud path.

Пример:

```ts
expect(
  routeModel({
    classification: "user-private"
  })
).toEqual("local");
```

И architecture rule:

```text
content-engine
```

не должен импортировать:

```text
OpenRouter client
remote AI client
backend upload client
```

Можно добавить dependency-boundary test.

---

# 59. Definition of Done для всей системы

Система считается архитектурно правильной, если:

- [ ] документ может быть прочитан без backend processing;
- [ ] private content не покидает устройство для AI processing;
- [ ] connectors используются как source/sink, а не compute backend;
- [ ] есть JS и native local processing tiers;
- [ ] большие документы читаются targeted/chunked;
- [ ] `Uint8Array` является binary boundary;
- [ ] каждый chunk имеет location;
- [ ] локальный FTS search не требует LLM;
- [ ] local model получает только relevant chunks;
- [ ] cloud model fallback блокируется для private content;
- [ ] write реализован через patch;
- [ ] output валидируется перед persistence;
- [ ] original не уничтожается при failed edit;
- [ ] тяжёлые операции не блокируют UI thread;
- [ ] OCR выполняется on-device;
- [ ] production logs не содержат user document content;
- [ ] MCP API остаётся format-agnostic;
- [ ] новый adapter можно добавить без изменения LLM tool surface.

---

# 60. Практический порядок разработки

Не начинай с 10 форматов одновременно.

Оптимальный порядок:

```text
1. Privacy + contracts
2. Local files
3. TXT / MD
4. CSV
5. XLSX targeted read
6. SQLite FTS
7. XLSX edit
8. DOCX read
9. DOCX patch
10. Native PDF text
11. On-device OCR
12. PPTX
13. advanced preservation
14. local vector retrieval
```

После каждого шага должен существовать working vertical slice через MCP и local agent.

---

# 61. Первичные технические источники

Coding-agent должен при внедрении проверять актуальные версии и API в официальной документации.

- Expo FileSystem  
  https://docs.expo.dev/versions/latest/sdk/filesystem/

- Expo DocumentPicker  
  https://docs.expo.dev/versions/latest/sdk/document-picker/

- Expo SQLite  
  https://docs.expo.dev/versions/latest/sdk/sqlite/

- Expo SecureStore  
  https://docs.expo.dev/versions/latest/sdk/securestore/

- Expo Modules API  
  https://docs.expo.dev/modules/get-started/

- Expo Modules API reference  
  https://docs.expo.dev/modules/module-api/

- SheetJS installation  
  https://docs.sheetjs.com/docs/getting-started/installation/nodejs/

- SheetJS React Native demo  
  https://docs.sheetjs.com/docs/demos/mobile/reactnative/

- JSZip  
  https://stuk.github.io/jszip/

- fast-xml-parser  
  https://github.com/NaturalIntelligence/fast-xml-parser

- Mammoth  
  https://github.com/mwilliamson/mammoth.js

- docx patchDocument  
  https://docx.js.org/api/functions/patchDocument.html

- pdf-lib  
  https://github.com/Hopding/pdf-lib

- Android PdfRenderer  
  https://developer.android.com/reference/android/graphics/pdf/PdfRenderer

- PdfBox-Android  
  https://github.com/TomRoush/PdfBox-Android

- ML Kit Text Recognition v2  
  https://developers.google.com/ml-kit/vision/text-recognition/v2/android

- HyperFormula  
  https://hyperformula.handsontable.com/docs/

---

# 62. Финальное архитектурное правило

Если разработчик в будущем сталкивается с задачей:

> «Телефон не справляется, давайте просто отправим документ на backend»

ответ архитектуры должен быть:

```text
Нет remote-processing route.
```

Нужно вместо этого выбрать одно из:

```text
targeted read
streaming
native processing
local indexing
lower-memory strategy
batch processing
user-selected scope
unsupported-on-this-device
```

Именно это сохраняет смысл продукта как локального AI-agent.

