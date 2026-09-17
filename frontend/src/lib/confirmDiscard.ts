import { usePipelineStore } from '../stores/pipelineStore';

/**
 * True when it is safe to replace the canvas: either there is no run
 * result, or the user confirms discarding it. Undo restores nodes and
 * edges, never the result — the copy says so.
 */
export function confirmDiscardResult(): boolean {
  if (usePipelineStore.getState().resultData === null) return true;
  return window.confirm(
    'This will discard the current run result (undo will not bring it back). Continue?',
  );
}
