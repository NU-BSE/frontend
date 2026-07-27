/**
 * Engine abstraction for Creepy.IM.
 *
 * The UI never talks to a model directly. It talks to `useChat` from
 * `@tanstack/ai-react`, which talks to a ConnectionAdapter, which talks to
 * one of these engines. Swapping on-device inference for a hosted model is
 * therefore a one-line change in `resolveEngine()` and touches no screen.
 */

/** A single turn, flattened to plain text — the lowest common denominator
 *  every engine (on-device GGUF, hosted API, stub) can consume. */
export interface EnginePrompt {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface EngineGenerateOptions {
  /** Aborts generation. On-device engines must stop the decode loop. */
  signal?: AbortSignal;
  /** Arbitrary per-send data forwarded from the client (`useChat` `data`). */
  data?: Record<string, unknown>;
}

export interface LlmEngine {
  /** Stable identifier surfaced in the UI and in AG-UI `model` fields. */
  readonly id: string;
  /** Human-readable name for settings screens. */
  readonly label: string;
  /** True once weights are loaded and the engine can serve a generation. */
  isReady(): boolean;
  /** Idempotent. Called before the first generation; may download/mmap weights. */
  prepare(): Promise<void>;
  /**
   * Stream a completion as plain text deltas. The adapter layer wraps these
   * into AG-UI protocol events, so engines stay protocol-agnostic.
   */
  generate(
    messages: EnginePrompt[],
    options?: EngineGenerateOptions,
  ): AsyncIterable<string>;
  /** Release native resources (context, KV cache). Safe to call twice. */
  dispose?(): Promise<void>;
}

/** Why a given engine was selected — surfaced in the UI so the user knows
 *  whether their words left the device. */
export type EngineOrigin = 'on-device' | 'remote' | 'stub';

export interface EngineDescriptor {
  engine: LlmEngine;
  origin: EngineOrigin;
  /** Explains why the selected profile fell back to the offline preview. */
  degradedReason?: string;
}
