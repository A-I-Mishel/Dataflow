export const NODE_TYPES = [
  "drop-na",
  "fill-na",
  "drop-column",
  "drop-duplicates",
  "rename-column",
  "filter-rows",
  "normalize",
  "encode-categorical",
  "sort",
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

export interface NodeConfig {
  subset?: boolean;
  columns?: string[];
  strategy?: "mean" | "median" | "mode" | "constant";
  value?: string | number;
  mapping?: Record<string, string>;
  conditions?: Array<{
    column: string;
    operator: string;
    value: string | number;
    logic?: "AND" | "OR";
    /**
     * Client-only stable React key. Never sent to the backend —
     * serializeNodes() strips it — so rows keep identity (and focus)
     * across sibling add/remove. Optional for legacy configs.
     */
    id?: string;
  }>;
  method?: string;
  by?: string[];
  ascending?: boolean;
}

export interface PipelineNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: { label: string; config: NodeConfig };
}

export interface PipelineEdge {
  id: string;
  source: string;
  target: string;
}

export interface DataPreview {
  columns: string[];
  dtypes: Record<string, string>;
  row_count: number;
  preview: Record<string, unknown>[];
  missing_values: Record<string, number>;
  large?: boolean;
  // Optional: sessions persisted before the filename field existed lack it.
  filename?: string;
  // Optional: absent on old persisted sessions (treated as unavailable)
  // and null on large files (no full scan by design). Missing keys are
  // unknown — never zero.
  unique_counts?: Record<string, number> | null;
  cardinality_available?: boolean;
  one_hot_max_cells?: number;
}

export interface ColumnProfile {
  dtype: string;
  null_count: number;
  null_pct: number;
  // Optional: unknown before the first run (upload-time fallback never
  // scans cardinality). Absent means "not yet scanned" — never zero.
  unique_count?: number;
  min?: number;
  max?: number;
  mean?: number;
  median?: number;
  std?: number;
  histogram?: Array<{ bin_start: number; count: number }>;
  top_values?: Array<{ value: string; count: number }>;
  date_min?: string;
  date_max?: string;
  date_histogram?: Array<{ date: string; count: number }>;
}

export interface ProfileData {
  shape: [number, number];
  // Null before the first run: memory is only measured server-side.
  memory_usage_mb: number | null;
  total_missing: number;
  columns: Record<string, ColumnProfile>;
}

export interface UploadResponse {
  session_id: string;
  columns: string[];
  dtypes: Record<string, string>;
  row_count: number;
  preview: Record<string, unknown>[];
  missing_values: Record<string, number>;
  large?: boolean;
  // Optional: sessions persisted before the filename field existed lack it.
  filename?: string;
  unique_counts?: Record<string, number> | null;
  cardinality_available?: boolean;
  one_hot_max_cells?: number;
}

export interface NodePreview {
  node_id: string;
  shape: [number, number];
  columns: string[];
  dtypes: Record<string, string>;
  preview: Record<string, unknown>[];
  approximate?: boolean;
}

export interface ExecuteResponse {
  preview: Record<string, unknown>[];
  shape: [number, number];
  columns: string[];
  dtypes: Record<string, string>;
  profile: ProfileData;
  intermediates?: NodePreview[];
}

export interface GenerateResponse {
  code: string;
}
