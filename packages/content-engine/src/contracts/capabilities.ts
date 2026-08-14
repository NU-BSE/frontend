export interface DocumentCapabilities {
  inspect: boolean;
  readText: boolean;
  readStructured: boolean;
  search: boolean;
  extract: boolean;
  create: boolean;
  edit: boolean;
  convert: boolean;
  preserveFormatting: boolean;
  comments: boolean;
  tables: boolean;
  images: boolean;
  formulas: boolean;
  sheets: boolean;
  slides: boolean;
  incrementalRead: boolean;
  incrementalWrite: boolean;
}
