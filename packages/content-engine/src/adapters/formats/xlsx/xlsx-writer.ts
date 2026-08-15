import * as XLSX from "xlsx";

export class XlsxWriter {
    async setCellValue(workbook: XLSX.WorkBook, sheetName: string, cellAddress: string, value: any) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) {
            throw new Error(`Sheet "${sheetName}" not found`);
        }
        sheet[cellAddress] = { v: value };
        sheet['!ref'] = XLSX.utils.encode_range(XLSX.utils.decode_range(sheet['!ref'] || 'A1'));
    }
    async addRow(workbook: XLSX.WorkBook, sheetName: string, rowData: any[]) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) {
            throw new Error(`Sheet "${sheetName}" not found`);
        }
        const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
        const newRowIndex = range.e.r + 1;
        rowData.forEach((value, colIndex) => {
            const cellAddress = XLSX.utils.encode_cell({ r: newRowIndex, c: colIndex });
            sheet[cellAddress] = { v: value };
        });
        range.e.r = newRowIndex;
        sheet['!ref'] = XLSX.utils.encode_range(range);
    }
    async writeWorkbook(workbook: XLSX.WorkBook) {
        XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    }
}