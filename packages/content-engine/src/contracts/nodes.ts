export interface TextNode {
  type: 'text';
  text: string;
}

export interface ParagraphNode {
  type: 'paragraph';
  id?: string;
  children: readonly TextNode[];
}

export interface HeadingNode {
  type: 'heading';
  id?: string;
  level: number;
  text: string;
}

export interface TableNode {
  type: 'table';
  id?: string;
  rows: readonly (readonly unknown[])[];
}

export interface SheetNode {
  type: 'sheet';
  name: string;
  range?: string;
  rows: readonly (readonly unknown[])[];
}

export interface ImageNode {
  type: 'image';
  id?: string;
  alt?: string;
  mimeType?: string;
}

export interface SlideNode {
  type: 'slide';
  number: number;
  title?: string;
  children: readonly DocumentNode[];
}

export type DocumentNode =
  | TextNode
  | ParagraphNode
  | HeadingNode
  | TableNode
  | SheetNode
  | ImageNode
  | SlideNode;

export interface CanonicalDocument {
  type: 'document';
  children: readonly DocumentNode[];
}
