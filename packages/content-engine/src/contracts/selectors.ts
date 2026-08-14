export interface RowWindow {
  from?: number;
  to?: number;
}

export interface SpreadsheetSelector {
  kind: 'spreadsheet';
  sheet?: string;
  range?: string;
  rows?: RowWindow;
}

export interface PageSelector {
  kind: 'pages';
  pages: readonly number[];
}

export interface HeadingSelector {
  kind: 'heading';
  heading: string;
}

export interface ParagraphSelector {
  kind: 'paragraph';
  paragraphId: string;
}

export interface SlideSelector {
  kind: 'slides';
  slides: readonly number[];
  shapeId?: string;
}

export interface CursorSelector {
  kind: 'cursor';
  cursor: string;
}

export interface WholeDocumentSelector {
  kind: 'all';
}

export type DocumentSelector =
  | SpreadsheetSelector
  | PageSelector
  | HeadingSelector
  | ParagraphSelector
  | SlideSelector
  | CursorSelector
  | WholeDocumentSelector;
