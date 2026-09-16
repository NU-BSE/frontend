import type {
  CompletionCategory,
  ErrorCategory,
  MetricsEvent,
  MetricsEventType,
} from './types';

const VALID_EVENT_TYPES: Set<MetricsEventType> = new Set([
  'engine_load',
  'inference',
  'agent_run',
]);

const VALID_COMPLETION_CATEGORIES: Set<CompletionCategory> = new Set([
  'success',
  'cancelled',
  'error',
  'max_steps_reached',
]);

const VALID_ERROR_CATEGORIES: Set<ErrorCategory> = new Set([
  'abort',
  'timeout',
  'out_of_memory',
  'context_full',
  'validation',
  'unknown',
]);

/**
 * Positive allowlist of permitted technical metadata fields.
 * Any property not explicitly listed here will be stripped.
 */
const ALLOWED_FIELDS = new Set<string>([
  'schemaVersion',
  'timestamp',
  'eventType',
  'engine',
  'loadDurationMs',
  'timeToFirstTokenMs',
  'generationMs',
  'tokensPerSecond',
  'inputTokens',
  'outputTokens',
  'toolCallCount',
  'totalSteps',
  'completionCategory',
  'errorCategory',
  'memoryBytes',
]);

function isFiniteNumber(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val);
}

function sanitizeString(val: unknown, maxLen = 100): string | undefined {
  if (typeof val !== 'string') return undefined;
  const trimmed = val.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

/**
 * Sanitize raw input into a privacy-safe `MetricsEvent` containing ONLY allowlisted fields.
 * Returns `null` if required structural fields (`eventType`, `timestamp`) are missing or invalid.
 */
export function sanitizeMetricsEvent(raw: unknown): MetricsEvent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;

  const rawEventType = sanitizeString(record.eventType);
  if (!rawEventType || !VALID_EVENT_TYPES.has(rawEventType as MetricsEventType)) {
    return null;
  }
  const eventType = rawEventType as MetricsEventType;

  const timestamp = isFiniteNumber(record.timestamp)
    ? Math.floor(record.timestamp)
    : Date.now();

  const cleanEvent: MetricsEvent = {
    schemaVersion: 1,
    timestamp,
    eventType,
  };

  // Process allowed optional fields explicitly
  for (const key of Object.keys(record)) {
    if (!ALLOWED_FIELDS.has(key)) {
      continue;
    }

    switch (key) {
      case 'engine': {
        const engine = sanitizeString(record.engine);
        if (engine) cleanEvent.engine = engine;
        break;
      }
      case 'loadDurationMs': {
        if (isFiniteNumber(record.loadDurationMs) && record.loadDurationMs >= 0) {
          cleanEvent.loadDurationMs = Math.round(record.loadDurationMs);
        }
        break;
      }
      case 'timeToFirstTokenMs': {
        if (isFiniteNumber(record.timeToFirstTokenMs) && record.timeToFirstTokenMs >= 0) {
          cleanEvent.timeToFirstTokenMs = Math.round(record.timeToFirstTokenMs);
        }
        break;
      }
      case 'generationMs': {
        if (isFiniteNumber(record.generationMs) && record.generationMs >= 0) {
          cleanEvent.generationMs = Math.round(record.generationMs);
        }
        break;
      }
      case 'tokensPerSecond': {
        if (isFiniteNumber(record.tokensPerSecond) && record.tokensPerSecond >= 0) {
          cleanEvent.tokensPerSecond = Number(record.tokensPerSecond.toFixed(2));
        }
        break;
      }
      case 'inputTokens': {
        if (isFiniteNumber(record.inputTokens) && record.inputTokens >= 0) {
          cleanEvent.inputTokens = Math.floor(record.inputTokens);
        }
        break;
      }
      case 'outputTokens': {
        if (isFiniteNumber(record.outputTokens) && record.outputTokens >= 0) {
          cleanEvent.outputTokens = Math.floor(record.outputTokens);
        }
        break;
      }
      case 'toolCallCount': {
        if (isFiniteNumber(record.toolCallCount) && record.toolCallCount >= 0) {
          cleanEvent.toolCallCount = Math.floor(record.toolCallCount);
        }
        break;
      }
      case 'totalSteps': {
        if (isFiniteNumber(record.totalSteps) && record.totalSteps >= 0) {
          cleanEvent.totalSteps = Math.floor(record.totalSteps);
        }
        break;
      }
      case 'completionCategory': {
        const cat = sanitizeString(record.completionCategory);
        if (cat && VALID_COMPLETION_CATEGORIES.has(cat as CompletionCategory)) {
          cleanEvent.completionCategory = cat as CompletionCategory;
        }
        break;
      }
      case 'errorCategory': {
        const cat = sanitizeString(record.errorCategory);
        if (cat && VALID_ERROR_CATEGORIES.has(cat as ErrorCategory)) {
          cleanEvent.errorCategory = cat as ErrorCategory;
        }
        break;
      }
      case 'memoryBytes': {
        if (isFiniteNumber(record.memoryBytes) && record.memoryBytes >= 0) {
          cleanEvent.memoryBytes = Math.floor(record.memoryBytes);
        }
        break;
      }
    }
  }

  return cleanEvent;
}
