import * as XLSX from "xlsx";

export class XlsxValidator {
    async validateWorkbook(bytes: Uint8Array) {
        try {
            XLSX.read(bytes, { type: "array" });
            return true;
        } catch (error) {
            return false;
        }
    }
    async validateSheet(bytes: Uint8Array, sheetName: string) {
        try {
            const workbook = XLSX.read(bytes, { type: "array" });
            const sheet = workbook.Sheets[sheetName];
            return !!sheet;
        } catch (error) {
            return false;
        }
    }
    async validateCellValue(bytes: Uint8Array, sheetName: string, cellAddress: string) {
        try {
            const workbook = XLSX.read(bytes, { type: "array" });
            const sheet = workbook.Sheets[sheetName];
            if (!sheet) {
                return false;
            }
            const cell = sheet[cellAddress];
            return !!cell;
        } catch (error) {
            return false;
        }
    }
}