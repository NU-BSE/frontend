/**
 * The write model: targeted patch operations.
 *
 * Reading may normalize a document into chunks, but editing must NOT
 * regenerate the whole document from those chunks — that would lose the
 * original formatting, styles, formulas, charts and unknown parts. Instead an
 * adapter applies the smallest possible mutation to its native representation.
 */

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
      content: unknown;
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

/**
 * How a source adapter persists an edited document.
 *
 * `new-revision` (default for early versions) keeps the original intact and
 * creates a new revision; `replace` overwrites in place. A temporary copy →
 * atomic replace is the safe default until validation is proven.
 */
export interface PersistOptions {
  mode: 'new-revision' | 'replace';
  expectedRevision?: string;
}
