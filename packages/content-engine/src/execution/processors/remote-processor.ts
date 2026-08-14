/**
 * Remote execution target: a separate backend / document-processing service.
 *
 * Contract only — no backend client, endpoints or polling are implemented
 * here. Reserved for OCR, scanned PDFs, very large workbooks/PDFs, legacy
 * DOC/PPT, Office → PDF / PDF → editable conversion, and other heavy or
 * long-running work.
 *
 * Remote work is modelled as jobs so a 200-page OCR or large-workbook analysis
 * can outlive a single request/response without changing the agent-facing API.
 */
import type { DocumentProcessor } from './processor';

export interface RemoteDocumentProcessor extends DocumentProcessor {
  readonly target: 'remote';
}

export type RemoteJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * A long-running remote job. Future backend flow:
 *
 *   upload/reference document
 *        ↓
 *   create job
 *        ↓
 *   jobId
 *        ↓
 *   poll / websocket / push
 *        ↓
 *   result
 */
export interface RemoteDocumentJob {
  id: string;
  status: RemoteJobStatus;
  progress?: number;
  createdAt?: number;
}
