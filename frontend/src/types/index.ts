export type NodeType =
  | 'drop-na'
  | 'fill-na'
  | 'drop-column'
  | 'rename-column'
  | 'filter-rows'
  | 'normalize'
  | 'encode-categorical'
  | 'sort';

export interface NodeConfig {
  subset?: boolean;
  columns?: string[];
  strategy?: 'mean' | 'median' | 'mode' | 'constant';
  value?: string | number;
  mapping?: Record<string, string>;
  conditions?: Array<{
    column: string;
    operator: string;
    value: string | number;
    logic?: 'AND' | 'OR';
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
}

export interface ColumnProfile {
  dtype: string;
  null_count: number;
  null_pct: number;
  unique_count: number;
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
  memory_usage_mb: number;
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
}

export interface ExecuteResponse {
  preview: Record<string, unknown>[];
  shape: [number, number];
  columns: string[];
  dtypes: Record<string, string>;
  profile: ProfileData;
}

export interface GenerateResponse {
  code: string;
}
