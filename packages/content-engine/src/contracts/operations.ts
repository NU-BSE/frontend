import type { DocumentNode } from './nodes';

export type DocumentPatchOperation =
  | {
      op: 'set_cell';
      sheet: string;
      cell: string;
      value: unknown;
    }
  | {
      op: 'set_range';
      sheet: string;
      range: string;
      values: readonly (readonly unknown[])[];
    }
  | {
      op: 'replace_text';
      targetId: string;
      text: string;
    }
  | {
      op: 'insert_after';
      targetId: string;
      content: DocumentNode;
    }
  | {
      op: 'delete';
      targetId: string;
    }
  | {
      op: 'add_sheet';
      name: string;
    }
  | {
      op: 'rename_sheet';
      from: string;
      to: string;
    }
  | {
      op: 'replace_slide_text';
      slide: number;
      shapeId: string;
      text: string;
    };

export interface DocumentPatch {
  operations: readonly DocumentPatchOperation[];
  expectedRevision?: string;
}
