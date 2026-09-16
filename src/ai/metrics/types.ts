export type MetricsEventType = 'engine_load' | 'inference' | 'agent_run';

export type CompletionCategory =
  | 'success'
  | 'cancelled'
  | 'error'
  | 'max_steps_reached';

export type ErrorCategory =
  | 'abort'
  | 'timeout'
  | 'out_of_memory'
  | 'context_full'
  | 'validation'
  | 'unknown';

export interface MetricsEvent {
  schemaVersion: 1;
  timestamp: number;
  eventType: MetricsEventType;

  engine?: string;

  loadDurationMs?: number;
  timeToFirstTokenMs?: number;
  generationMs?: number;
  tokensPerSecond?: number;

  inputTokens?: number;
  outputTokens?: number;

  toolCallCount?: number;
  totalSteps?: number;

  completionCategory?: CompletionCategory;
  errorCategory?: ErrorCategory;

  memoryBytes?: number;
}

export interface ExportedMetricsPayload {
  schemaVersion: 1;
  exportedAt: number;
  events: MetricsEvent[];
}
