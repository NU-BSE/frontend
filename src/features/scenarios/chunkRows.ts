/**
 * Split a list into fixed-size rows for an explicit grid.
 *
 * Why not `flexWrap`: wrapping decides column count from *measured* width, so
 * any width rule that overflows by even a fraction of a point silently drops
 * to one column — which is exactly what happened here twice, first with
 * `maxWidth: 48.5%` + a 16pt gap, and again at exact fit where pixel rounding
 * can tip the sum over. Rendering explicit rows of `flex: 1` cells removes the
 * measurement from the decision entirely: the column count is structural, so
 * it cannot depend on arithmetic at all.
 *
 * The last row is padded with `null` so a short final row keeps its cells at
 * the same width instead of stretching them across the row.
 */
export function chunkRows<T>(items: T[], columns: number): (T | null)[][] {
  if (columns < 1) throw new Error('columns must be at least 1');

  const rows: (T | null)[][] = [];
  for (let i = 0; i < items.length; i += columns) {
    const row: (T | null)[] = items.slice(i, i + columns);
    while (row.length < columns) row.push(null);
    rows.push(row);
  }
  return rows;
}
