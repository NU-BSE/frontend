import * as XLSX from 'xlsx';
import JSZip from 'jszip';

import type { BinaryDocument } from '../../../contracts/binary-document';
import type {
  DocumentValidationIssue,
  DocumentValidationResult,
} from '../../../contracts/results';

/**
 * Machine-readable validation issue codes for the XLSX adapter.
 */
export const XLSX_VALIDATION_CODES = {
  EMPTY_INPUT: 'EMPTY_INPUT',
  INVALID_XLSX_CONTAINER: 'INVALID_XLSX_CONTAINER',
  ENCRYPTED_OR_LEGACY: 'ENCRYPTED_OR_LEGACY_XLS',
  MISSING_WORKBOOK_XML: 'MISSING_WORKBOOK_XML',
  WORKBOOK_PARSE_FAILED: 'WORKBOOK_PARSE_FAILED',
  NO_WORKSHEETS: 'NO_WORKSHEETS',
  INVALID_SHEET_RANGE: 'INVALID_SHEET_RANGE',
  SERIALIZATION_FAILED: 'SERIALIZATION_FAILED',
} as const;

export type XlsxValidationCode =
  (typeof XLSX_VALIDATION_CODES)[keyof typeof XLSX_VALIDATION_CODES];

function issue(code: string, message: string): DocumentValidationIssue {
  return { code, message };
}

function invalid(code: string, message: string): DocumentValidationResult {
  return { valid: false, issues: [issue(code, message)] };
}

function isZipSignature(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false;
  const b2 = bytes[2];
  const b3 = bytes[3];
  return (
    (b2 === 0x03 && b3 === 0x04) ||
    (b2 === 0x05 && b3 === 0x06) ||
    (b2 === 0x07 && b3 === 0x08)
  );
}

function isOleSignature(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0 &&
    bytes[4] === 0xa1 &&
    bytes[5] === 0xb1 &&
    bytes[6] === 0x1a &&
    bytes[7] === 0xe1
  );
}

/**
 * Validates XLSX bytes and returns a structured `DocumentValidationResult`.
 *
 * The validation never includes cell content in messages; only technical,
 * machine-readable information is surfaced.
 */
export class XlsxValidator {
  async validate(input: BinaryDocument): Promise<DocumentValidationResult> {
    const bytes = input.bytes;

    if (bytes.length === 0) {
      return invalid(XLSX_VALIDATION_CODES.EMPTY_INPUT, 'Input is empty');
    }

    if (isOleSignature(bytes)) {
      return invalid(
        XLSX_VALIDATION_CODES.ENCRYPTED_OR_LEGACY,
        'Encrypted OOXML or legacy binary XLS container (OLE/CFB)',
      );
    }

    if (!isZipSignature(bytes)) {
      return invalid(
        XLSX_VALIDATION_CODES.INVALID_XLSX_CONTAINER,
        'Not a ZIP/OOXML container',
      );
    }

    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(bytes);
    } catch {
      return invalid(
        XLSX_VALIDATION_CODES.INVALID_XLSX_CONTAINER,
        'Corrupt ZIP container',
      );
    }

    if (!zip.file('xl/workbook.xml')) {
      return invalid(
        XLSX_VALIDATION_CODES.MISSING_WORKBOOK_XML,
        'Missing xl/workbook.xml entry',
      );
    }

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(bytes, { type: 'array', cellFormula: true });
    } catch (error) {
      const message =
        error instanceof Error && /password|encrypt/iu.test(error.message)
          ? 'Workbook is encrypted or password-protected'
          : 'Workbook could not be parsed';
      return invalid(XLSX_VALIDATION_CODES.WORKBOOK_PARSE_FAILED, message);
    }

    if (workbook.SheetNames.length === 0) {
      return invalid(XLSX_VALIDATION_CODES.NO_WORKSHEETS, 'No worksheets found');
    }

    const issues: DocumentValidationIssue[] = [];
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      const ref = sheet?.['!ref'];
      if (ref && typeof ref === 'string') {
        try {
          XLSX.utils.decode_range(ref);
        } catch {
          issues.push(
            issue(
              XLSX_VALIDATION_CODES.INVALID_SHEET_RANGE,
              `Sheet "${name}" has an invalid used range`,
            ),
          );
        }
      }
    }

    return { valid: issues.length === 0, issues };
  }
}
