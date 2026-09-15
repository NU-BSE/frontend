/**
 * Shared conformance runner for document format adapters.
 *
 * Every adapter can use the same checks for detection, inspection,
 * targeted reads, search, round-trip mutation, patching, validation,
 * bad input, unsupported input, and large input handling.
 */

import type { DocumentFormatAdapter } from '../contracts/adapters';
import type { BinaryDocument } from '../contracts/binary-document';
import type { DocumentRef } from '../contracts/document-ref';
import type { DocumentPatch } from '../contracts/patches';
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

function documentRef(fixture: DocumentFixture): DocumentRef {
  return {
    id: fixture.name,
    source: 'generated',
    name: fixture.name,
    format: fixture.format,
    mimeType: fixture.format,
  };
}

function fixtureBinary(fixture: DocumentFixture): BinaryDocument {
  return {
    bytes: fixture.bytes ?? new Uint8Array(),
    fileName: fixture.name,
  };
}

function corruptedBinary(fixture: DocumentFixture): BinaryDocument {
  return {
    bytes: new Uint8Array([0, 1, 2, 3, 4, 5]),
    fileName: fixture.name,
  };
}

const XLSX_PATCH: DocumentPatch = {
  operations: [
    {
      op: 'set_cell',
      sheet: 'Sheet1',
      cell: 'A1',
      value: 'conformance-test',
    },
  ],
};

export async function runAdapterConformance(
  options: AdapterConformanceOptions,
): Promise<AdapterConformanceResult> {
  const passed: string[] = [];
  const failed: string[] = [];

  const fixture = options.fixtures.find(
    (item) => item.format === options.adapter.id,
  );

  if (!fixture) {
    return {
      passed,
      failed: [`No fixture found for adapter "${options.adapter.id}"`],
    };
  }

  const document = documentRef(fixture);

  const run = async (
    name: AdapterConformanceCheck,
    check: () => Promise<void>,
  ): Promise<void> => {
    try {
      await check();
      passed.push(name);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);

      failed.push(`${name}: ${message}`);
    }
  };

  // 1. Detection
  await run('detect', async () => {
    const result = await options.adapter.detect(
      fixtureBinary(fixture),
    );

    if (typeof result !== 'boolean') {
      throw new Error('detect() must return a boolean');
    }

    if (!result) {
      throw new Error(
        `detect() must detect valid ${fixture.format} fixture`,
      );
    }
  });

  // 2. Inspection
  await run('inspect', async () => {
    const result = await options.adapter.inspect(
      document,
      fixtureBinary(fixture),
    );

    if (!result || result.document.id !== document.id) {
      throw new Error('inspect() returned an invalid document');
    }

    if (!result.capabilities) {
      throw new Error('inspect() must return capabilities');
    }

    if (!result.structure) {
      throw new Error('inspect() must return document structure');
    }
  });

  // 3. Targeted read
  await run('targeted-read', async () => {
    const capabilities =
      await options.adapter.capabilities(document);

    if (!capabilities.read || !capabilities.targetedRead) {
      return;
    }

    const selector =
      fixture.format === 'xlsx'
        ? {
            kind: 'spreadsheet' as const,
            sheet: 'Sheet1',
            range: 'A1:B2',
          }
        : {
            kind: 'all' as const,
          };

    const result = await options.adapter.read(
      document,
      fixtureBinary(fixture),
      selector,
    );

    if (!result || !Array.isArray(result.chunks)) {
      throw new Error('read() returned an invalid result');
    }

    if (result.document.id !== document.id) {
      throw new Error('read() returned the wrong document');
    }
  });

  // 4. Search
  await run('search', async () => {
    const capabilities =
      await options.adapter.capabilities(document);

    if (!capabilities.search) {
      return;
    }

    if (!options.adapter.search) {
      throw new Error(
        'Adapter advertises search capability but has no search() method',
      );
    }

    const result = await options.adapter.search(
      document,
      fixtureBinary(fixture),
      'conformance-test',
    );

    if (!result || !Array.isArray(result.hits)) {
      throw new Error('search() returned an invalid result');
    }
  });

  // 5. Round-trip
  await run('roundtrip', async () => {
    const capabilities =
      await options.adapter.capabilities(document);

    if (!capabilities.update) {
      return;
    }

    if (!options.adapter.applyPatch) {
      throw new Error(
        'Adapter advertises update capability but has no applyPatch() method',
      );
    }

    // The current shared mutation fixture is XLSX-specific.
    if (fixture.format !== 'xlsx') {
      return;
    }

    const result = await options.adapter.applyPatch(
      document,
      fixtureBinary(fixture),
      XLSX_PATCH,
    );

    if (!(result.bytes instanceof Uint8Array)) {
      throw new Error(
        'applyPatch() must return Uint8Array bytes',
      );
    }

    const detected = await options.adapter.detect(result);

    if (!detected) {
      throw new Error(
        'round-trip output is not detected by the adapter',
      );
    }
  });

  // 6. Patch
  await run('patch', async () => {
    const capabilities =
      await options.adapter.capabilities(document);

    if (!capabilities.update) {
      return;
    }

    if (!options.adapter.applyPatch) {
      throw new Error(
        'Adapter advertises update capability but has no applyPatch() method',
      );
    }

    if (fixture.format !== 'xlsx') {
      return;
    }

    const result = await options.adapter.applyPatch(
      document,
      fixtureBinary(fixture),
      XLSX_PATCH,
    );

    if (!(result.bytes instanceof Uint8Array)) {
      throw new Error(
        'applyPatch() must return Uint8Array bytes',
      );
    }
  });

  // 7. Validation
  await run('validation', async () => {
    if (!options.adapter.validate) {
      return;
    }

    const result = await options.adapter.validate(
      fixtureBinary(fixture),
    );

    if (
      !result ||
      typeof result.valid !== 'boolean' ||
      !Array.isArray(result.issues)
    ) {
      throw new Error(
        'validate() returned an invalid result',
      );
    }

    if (!result.valid) {
      throw new Error(
        'validate() rejected a valid fixture',
      );
    }
  });

  // 8. Bad input
  await run('bad-input', async () => {
    const result = await options.adapter.detect(
      corruptedBinary(fixture),
    );

    if (typeof result !== 'boolean') {
      throw new Error(
        'detect() must return a boolean for bad input',
      );
    }

    if (result) {
      throw new Error(
        'detect() should reject corrupted input',
      );
    }
  });

  // 9. Unsupported / encrypted-like input
  await run('encrypted-input', async () => {
    const result = await options.adapter.detect({
      bytes: new Uint8Array([
        0xff,
        0xd8,
        0xff,
        0xe0,
        0x00,
        0x10,
      ]),
      fileName: fixture.name,
    });

    if (typeof result !== 'boolean') {
      throw new Error(
        'detect() must return a boolean',
      );
    }

    if (result) {
      throw new Error(
        'detect() should reject unsupported input',
      );
    }
  });

  // 10. Large input guard
  await run('large-input-guard', async () => {
    const largeInput: BinaryDocument = {
      bytes: new Uint8Array(1024 * 1024),
      fileName: fixture.name,
    };

    const result =
      await options.adapter.detect(largeInput);

    if (typeof result !== 'boolean') {
      throw new Error(
        'detect() must return a boolean for large input',
      );
    }
  });

  return {
    passed,
    failed,
  };
}