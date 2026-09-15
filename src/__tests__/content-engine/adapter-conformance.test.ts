import * as XLSX from 'xlsx';

import { XlsxAdapter } from '@/../packages/content-engine/src/adapters/formats/xlsx';
import { runAdapterConformance } from '@/../packages/content-engine/src/testing/conformance';

function createXlsxFixture(): Uint8Array {
  const workbook = XLSX.utils.book_new();

  const worksheet = XLSX.utils.aoa_to_sheet([
    ['Name', 'Value'],
    ['Test', 'conformance-test'],
  ]);

  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');

  const output = XLSX.write(workbook, {
    bookType: 'xlsx',
    type: 'array',
  });

  return new Uint8Array(output);
}

describe('XlsxAdapter conformance', () => {
  it('runs the shared conformance suite', async () => {
    const result = await runAdapterConformance({
      adapter: new XlsxAdapter(),
      fixtures: [
        {
          name: 'simple.xlsx',
          format: 'xlsx',
          bytes: createXlsxFixture(),
        },
      ],
    });

    expect(result.failed).toEqual([]);
  });
});