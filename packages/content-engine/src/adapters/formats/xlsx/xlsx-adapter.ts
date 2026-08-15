import * as XLSX from "xlsx";

export class XlsxAdapter {
  async inspect(bytes: Uint8Array) {
    const workbook = XLSX.read(bytes, {
      type: "array",
    });

    return {
      sheets: workbook.SheetNames.map((name) => ({
        name,
      })),
    };
  }

  async readSheet(
    bytes: Uint8Array,
    sheetName: string,
  ) {
    const workbook = XLSX.read(bytes, {
      type: "array",
    });

    const sheet =
      workbook.Sheets[sheetName];

    if (!sheet) {
      throw new Error(
        `Sheet "${sheetName}" not found`,
      );
    }

    const rows =
      XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: null,
        raw: true,
      });

    return {
      sheet: sheetName,
      rows,
    };
  }
}