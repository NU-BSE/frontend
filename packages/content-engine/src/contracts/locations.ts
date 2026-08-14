/**
 * A stable reference to a region inside a document.
 *
 * Locations are what make targeted read → later targeted edit possible: the
 * engine can hand the model a chunk, and the model can refer back to exactly
 * that chunk's location when it asks for a patch. Locations are adapter-owned
 * (an XLSX adapter names sheets/ranges, a DOCX adapter names paragraphs), so
 * the fields are all optional and meaning depends on the format.
 */
export interface DocumentLocation {
  sheet?: string;
  range?: string;
  cell?: string;

  page?: number;

  paragraphId?: string;
  /** Path of headings leading to this location, e.g. ["3. Требования", "3.2 Материалы"]. */
  headingPath?: readonly string[];
  heading?: string;

  slide?: number;
  shapeId?: string;

  bbox?: readonly number[];
}
