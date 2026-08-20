/**
 * Adapter conformance contract.
 *
 * Every format adapter must eventually pass the same suite — detect, inspect,
 * targeted read, search, roundtrip, patch, validation, bad input, encrypted
 * input and the large-input guard. The runner itself is implemented with the
 * first real adapter; this file only fixes its shape so adapters and tests
 * share one vocabulary.
 */
import type { DocumentFormatAdapter } from '../contracts/adapters';
import type { DocumentFixture } from './fixtures';

export const ADAPTER_CONFORMANCE_CHECKS = [
  'detect',
  'inspect',
  'targeted-read',
  'search',
  'roundtrip',
  'patch',
  'validation',
  'bad-input',
  'encrypted-input',
  'large-input-guard',
] as const;

export type AdapterConformanceCheck =
  (typeof ADAPTER_CONFORMANCE_CHECKS)[number];

export interface AdapterConformanceOptions {
  adapter: DocumentFormatAdapter;
  fixtures: readonly DocumentFixture[];
}

export interface AdapterConformanceResult {
  passed: readonly string[];
  failed: readonly string[];
}

export type AdapterConformanceRunner = (
  options: AdapterConformanceOptions,
) => Promise<AdapterConformanceResult>;
