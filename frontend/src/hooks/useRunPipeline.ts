import { useCallback } from 'react';
import toast from 'react-hot-toast';

import { executePipeline, generateCode } from '../lib/api';
import { getDisconnectedNodes, hasCycle, validateNodeConfigs } from '../lib/validatePipeline';
import { usePipelineStore } from '../stores/pipelineStore';

function toMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function useRunPipeline(): { run: () => Promise<void>; canRun: boolean } {
  const sessionId = usePipelineStore((state) => state.sessionId);
  const nodes = usePipelineStore((state) => state.nodes);
  const edges = usePipelineStore((state) => state.edges);
  const columnList = usePipelineStore((state) => state.columnList);
  const originalData = usePipelineStore((state) => state.originalData);
  const isLoading = usePipelineStore((state) => state.isLoading);

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
    const disconnected = getDisconnectedNodes(nodes, edges);
    if (disconnected.length > 0) {
      toast.error(`Disconnected nodes detected: ${disconnected.join(', ')}`);
      return;
    }
    // Validate against the stable original columns plus any names created by
    // rename nodes. The live columnList tracks the latest result instead, so
    // using it here would flag valid rename/drop pipelines on re-runs.
    const baseColumns = originalData !== null ? originalData.columns : columnList;
    const knownColumns = new Set<string>(baseColumns);
    for (const node of nodes) {
      const mapping = node.data.config.mapping;
      if (mapping !== undefined) {
        for (const created of Object.values(mapping)) {
          knownColumns.add(created);
        }
      }
    }
    const configErrors = validateNodeConfigs(nodes, Array.from(knownColumns));
    if (configErrors.length > 0) {
      for (const error of configErrors) {
        toast.error(error.message);
      }
      return;
    }

    usePipelineStore.getState().setLoading(true);
    try {
      const result = await executePipeline(sessionId, nodes, edges);
      usePipelineStore.getState().setResult(result);
      toast.success(
        `Pipeline executed — ${result.shape[0]} rows, ${result.shape[1]} columns`,
      );
      const generated = await generateCode(sessionId, nodes, edges);
      usePipelineStore.getState().setGeneratedCode(generated.code);
      usePipelineStore.getState().setActiveTab('preview');
    } catch (error: unknown) {
      toast.error(toMessage(error, 'Pipeline execution failed.'));
    } finally {
      usePipelineStore.getState().setLoading(false);
    }
  }, [sessionId, nodes, edges, columnList, originalData]);

  return { run, canRun: sessionId !== null && nodes.length > 0 && !isLoading };
}
