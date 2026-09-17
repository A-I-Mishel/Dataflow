/**
 * Pure one-hot width forecast: upload-time estimate of what selecting
 * columns for one-hot encoding would produce. No hooks, no store, no I/O.
 *
 * Mirrors backend/transforms/encode_categorical.py exactly, including its
 * quirks:
 *   dummyColumns = sum(upload-time unique counts, keyed by column, i.e.
 *                    config duplicates collapse exactly like the backend's
 *                    `uniques` dict)
 *   keptColumns  = input columns - raw selected-in-schema count
 *                    (backend counts raw len(target), duplicates included)
 *   estimatedCells = uploadRowCount x (keptColumns + dummyColumns)
 * and the backend refuses when estimatedCells > limit (strictly greater;
 * exactly at the limit passes).
 *
 * Forecast, not guarantee: upstream transforms may change rows, columns
 * and cardinality before execution. The backend remains authoritative.
 */

export type ForecastStatus = 'normal' | 'exceeds' | 'unavailable';

export interface OneHotForecastInput {
  /** Current Encode input schema (position-aware, post upstream effects). */
  schemaCols: string[];
  /** Configured selection, raw (may contain stale names or duplicates). */
  selected: string[];
  /** Upload-time row count. */
  rowCount: number;
  /** Upload-time per-column cardinality (nunique(dropna=True)). */
  uniqueCounts: Record<string, number> | null | undefined;
  /** False for large files and old persisted sessions. */
  cardinalityAvailable: boolean;
  /** Authoritative backend cap; undefined on old persisted sessions. */
  oneHotMaxCells: number | undefined;
}

export interface ForecastColumn {
  column: string;
  /** Known unique count, or null when unknown (never zero-as-unknown). */
  uniqueValues: number | null;
}

export interface OneHotForecast {
  /** Selected names that are current inputs (raw order, duplicates kept). */
  selectedInSchema: string[];
  /**
   * Selected names the forecast cannot account for: unknown cardinality
   * (renamed/unmapped/large-file/old-session) or stale config no longer in
   * the schema. Unknown is unknown — never zero, never dropped silently.
   */
  unknownColumns: string[];
  perColumn: ForecastColumn[];
  dummyColumns: number | null;
  keptColumns: number | null;
  estimatedColumns: number | null;
  estimatedRows: number | null;
  estimatedCells: number | null;
  cardinalityAvailable: boolean;
  status: ForecastStatus;
  /**
   * Threshold-free "large expansion" markers: columns whose individual
   * removal would flip exceeds → normal. Empty unless status is exceeds.
   */
  expansionDrivers: string[];
}

/** Read a cardinality value soundly: non-numbers are treated as unknown. */
function readCount(
  uniqueCounts: Record<string, number> | null | undefined,
  cardinalityAvailable: boolean,
  schemaSet: Set<string>,
  column: string,
): number | null {
  if (!cardinalityAvailable || uniqueCounts === null || uniqueCounts === undefined) {
    return null;
  }
  if (!schemaSet.has(column)) return null;
  if (!Object.prototype.hasOwnProperty.call(uniqueCounts, column)) return null;
  const value: unknown = uniqueCounts[column];
  return typeof value === 'number' ? value : null;
}

export function calculateOneHotForecast(input: OneHotForecastInput): OneHotForecast {
  const {
    schemaCols,
    selected,
    rowCount,
    uniqueCounts,
    cardinalityAvailable,
    oneHotMaxCells,
  } = input;
  const schemaSet = new Set(schemaCols);
  const selectedInSchema = selected.filter((column) => schemaSet.has(column));

  const counts = new Map<string, number>();
  const unknownColumns: string[] = [];
  for (const column of selected) {
    const value = readCount(uniqueCounts, cardinalityAvailable, schemaSet, column);
    if (value === null) {
      if (!unknownColumns.includes(column)) unknownColumns.push(column);
    } else if (!counts.has(column)) {
      counts.set(column, value);
    }
  }
  const perColumn: ForecastColumn[] = selectedInSchema.map((column) => ({
    column,
    uniqueValues: counts.has(column)
      ? (counts.get(column) as number)
      : null,
  }));

  const unavailable = (): OneHotForecast => ({
    selectedInSchema,
    unknownColumns,
    perColumn,
    dummyColumns: null,
    keptColumns: null,
    estimatedColumns: null,
    estimatedRows: null,
    estimatedCells: null,
    cardinalityAvailable,
    status: 'unavailable',
    expansionDrivers: [],
  });

  // No metadata (large files, old sessions), no usable cap, or anything
  // unaccounted for: no forecast.
  // NOTE: an empty selection is mathematically the identity fold
  // (dummyColumns 0, everything kept) and IS computed below when reached —
  // but the UI must never route one-hot auto-detect mode here: backend
  // treats empty selection as encode-ALL, i.e. unbounded, not zero-width.
  if (
    !cardinalityAvailable ||
    uniqueCounts === null ||
    uniqueCounts === undefined ||
    oneHotMaxCells === undefined ||
    unknownColumns.length > 0
  ) {
    return unavailable();
  }

  let dummyColumns = 0;
  counts.forEach((value) => {
    dummyColumns += value;
  });
  const keptColumns = schemaCols.length - selectedInSchema.length;
  const estimatedColumns = keptColumns + dummyColumns;
  const estimatedCells = rowCount * estimatedColumns;
  const status: ForecastStatus = estimatedCells > oneHotMaxCells ? 'exceeds' : 'normal';

  const expansionDrivers: string[] =
    status === 'exceeds'
      ? [...counts.keys()].filter((column) => {
          const without =
            rowCount *
            (keptColumns + (dummyColumns - (counts.get(column) as number)));
          return without <= oneHotMaxCells;
        })
      : [];

  return {
    selectedInSchema,
    unknownColumns,
    perColumn,
    dummyColumns,
    keptColumns,
    estimatedColumns,
    estimatedRows: rowCount,
    estimatedCells,
    cardinalityAvailable,
    status,
    expansionDrivers,
  };
}

/** Compact display: 17842 → "17,842", 312500000 → "312.5M", 10000000 → "10M". */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1_000_000) return `${parseFloat((value / 1_000_000).toFixed(1))}M`;
  return value.toLocaleString('en-US');
}
