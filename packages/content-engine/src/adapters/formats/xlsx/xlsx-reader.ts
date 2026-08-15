import * as XLSX from "xlsx";

export class XlsxReader {
    async openWorkbook(bytes: Uint8Array) {
        const workbook = XLSX.read(bytes, {
            type: "array",
        });
        return workbook;
    }
    async listSheets(workbook: XLSX.WorkBook) {
        return workbook.SheetNames.map((name) => ({
            name,
        }));
    }
    async readRange(workbook: XLSX.WorkBook, sheetName: string, range: string) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) {
            throw new Error(`Sheet "${sheetName}" not found`);
        }
        return XLSX.utils.sheet_to_json(sheet, {
            range: range,
        });
    }
    async readRows(workbook: XLSX.WorkBook, sheetName: string) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) {
            throw new Error(`Sheet "${sheetName}" not found`);
        }
        return XLSX.utils.sheet_to_json(sheet, {
            header: 1
        });
    }
}