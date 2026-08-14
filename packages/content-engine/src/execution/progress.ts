/**
 * Progress + cancellation for heavy on-device work.
 *
 * All heavy operations must be async and interruptible — never run on the
 * JS/UI thread. The native tier does its work on a worker/native thread; the
 * JS tier yields through chunked, abortable steps.
 */
export type ProcessingPhase =
  | 'opening'
  | 'inspecting'
  | 'reading'
  | 'indexing'
  | 'ocr'
  | 'patching'
  | 'validating'
  | 'saving';

export interface ProcessingProgress {
  phase: ProcessingPhase;
  completed?: number;
  total?: number;
}

/** A cross-runtime cancellation signal (`AbortSignal` or an equivalent token). */
export interface ProcessingSignal {
  readonly aborted: boolean;
}
