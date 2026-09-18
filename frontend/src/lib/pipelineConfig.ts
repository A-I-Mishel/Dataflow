import type { NodeType } from "../types";

/**
 * Node types that need the full dataset in memory and are therefore
 * disabled in large-file (chunked) mode. Single source of truth shared by
 * the run gate (useRunPipeline), the palette (grey-out) and the canvas
 * drop guard — the backend remains the final enforcer at run time.
 */
export const LARGE_BLOCKED_TYPES: ReadonlySet<NodeType> = new Set([
  "sort",
  "normalize",
  "encode-categorical",
]);

export const LARGE_BLOCKED_MESSAGE =
  "Disabled in large-file mode — needs the full dataset. Remove it or run the exported script locally instead.";
