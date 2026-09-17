import { useCallback } from 'react';
import toast from 'react-hot-toast';

import { executePipeline, generateCode } from '../lib/api';
import {
  getDisconnectedNodes,
  hasCycle,
  validateLinearChain,
  validateNodeConfigs,
} from '../lib/validatePipeline';
import { usePipelineStore } from '../stores/pipelineStore';

function toMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

const LARGE_BLOCKED_TYPES = new Set(['sort', 'normalize', 'encode-categorical']);

export function useRunPipeline(): { run: () => Promise<void>; canRun: boolean } {
  const sessionId = usePipelineStore((state) => state.sessionId);
  const nodes = usePipelineStore((state) => state.nodes);
  const edges = usePipelineStore((state) => state.edges);
  const columnList = usePipelineStore((state) => state.columnList);
  const originalData = usePipelineStore((state) => state.originalData);
  const isLoading = usePipelineStore((state) => state.isLoading);
  const isLargeFile = usePipelineStore((state) => state.isLargeFile);

  const run = useCallback(async (): Promise<void> => {
    if (sessionId === null) {
      toast.error('Upload a CSV file first.');
      return;
    }
    if (nodes.length === 0) {
      toast.error('Add at least one node to the canvas.');
      return;
    }
    if (hasCycle(nodes, edges)) {
      toast.error('Pipeline has a cycle. Remove circular connections to continue.');
      return;
    }
    const linearError = validateLinearChain(nodes, edges);
    if (linearError !== null) {
      toast.error(linearError);
      return;
    }
    if (isLargeFile) {
      const blocked = nodes.filter((node) => LARGE_BLOCKED_TYPES.has(node.type));
      if (blocked.length > 0) {
        const names = blocked.map((node) => `"${node.data.label}"`).join(', ');
        toast.error(
          `Large-file mode: ${names} need the full dataset and are disabled. ` +
            'Remove them or run the exported script locally instead.',
        );
        return;
      }
    }
    const disconnected = getDisconnectedNodes(nodes, edges);
    if (disconnected.length > 0) {
      toast.error(`Disconnected nodes detected: ${disconnected.join(', ')}`);
      return;
    }
    // Validate against the stable original columns. The live columnList
    // tracks the latest result instead, so using it here would flag valid
    // rename/drop pipelines on re-runs. Rename outputs are NOT merged in:
    // validateNodeConfigs folds them per-node itself, positionally.
    // Dtypes come from the upload for the same reason (numeric checks).
    const baseColumns = originalData !== null ? originalData.columns : columnList;
    const baseDtypes = originalData !== null ? originalData.dtypes : undefined;
    const configErrors = validateNodeConfigs(nodes, edges, baseColumns, baseDtypes);
    if (configErrors.length > 0) {
      const message =
        configErrors.length === 1
          ? configErrors[0].message
          : `Pipeline has ${configErrors.length} issues:\n${configErrors.map((e) => `• ${e.message}`).join('\n')}`;
      toast.error(message);
      return;
    }

    usePipelineStore.getState().setLoading(true);
    usePipelineStore.getState().setViewingNodeId(null);
    usePipelineStore.getState().setAllNodeStatus('running');
    try {
      // /generate is sessionless (pure function of nodes/edges), so both
      // requests run in parallel. Codegen never blocks the result: if it
      // fails the preview still lands and the failure gets its own toast.
      const genSettled = generateCode(sessionId, nodes, edges).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      const result = await executePipeline(sessionId, nodes, edges);
      usePipelineStore.getState().setResult(result);
      usePipelineStore.getState().setAllNodeStatus('done');
      toast.success(
        `Pipeline executed — ${result.shape[0]} rows, ${result.shape[1]} columns`,
      );
      const gen = await genSettled;
      if (gen.ok) {
        usePipelineStore.getState().setGeneratedCode(gen.value.code);
      } else {
        toast.error(`Pipeline ran, but code export failed: ${toMessage(gen.error, 'unknown error')}`);
      }
      usePipelineStore.getState().setActiveTab('preview');
    } catch (error: unknown) {
      usePipelineStore.getState().setAllNodeStatus('error');
      toast.error(toMessage(error, 'Pipeline execution failed.'));
    } finally {
      usePipelineStore.getState().setLoading(false);
    }
  }, [sessionId, nodes, edges, columnList, originalData, isLargeFile]);

  return { run, canRun: sessionId !== null && nodes.length > 0 && !isLoading };
}
