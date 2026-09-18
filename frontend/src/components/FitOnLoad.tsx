import { useReactFlow } from "@xyflow/react";
import { useEffect, useRef } from "react";

import { usePipelineStore } from "../stores/pipelineStore";

/**
 * Reframes the canvas after template / saved-pipeline loads. Listens for
 * the store's transient `fitSignal` (bumped by loadTemplate/setCanvas) and
 * calls fitView — skipping the first render so a page reload with a
 * restored canvas never yanks the user's viewport. Renders nothing.
 * Must live inside <ReactFlow> (uses its context).
 */
export default function FitOnLoad() {
  const fitSignal = usePipelineStore((state) => state.fitSignal);
  const { fitView } = useReactFlow();
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    fitView({ padding: 0.2, duration: 300 });
  }, [fitSignal, fitView]);

  return null;
}
