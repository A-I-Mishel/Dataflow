import { ArrowUpDown } from "lucide-react";
import { Copy } from "lucide-react";
import { Droplets } from "lucide-react";
import { Filter } from "lucide-react";
import { Scale } from "lucide-react";
import { Tags } from "lucide-react";
import { Trash2 } from "lucide-react";
import { Type } from "lucide-react";
import { XCircle } from "lucide-react";
import type { DragEvent, KeyboardEvent } from "react";
import type { LucideIcon } from "lucide-react";
import toast from "react-hot-toast";

import { LARGE_BLOCKED_MESSAGE, LARGE_BLOCKED_TYPES } from "../lib/pipelineConfig";
import { usePipelineStore } from "../stores/pipelineStore";
import type { NodeType } from "../types";

interface PaletteItem {
  type: NodeType;
  icon: LucideIcon;
  label: string;
  description: string;
  group: "clean" | "transform" | "encode";
}

export const ITEMS: PaletteItem[] = [
  {
    type: "drop-na",
    icon: Trash2,
    label: "Drop Missing",
    description: "Remove rows with nulls",
    group: "clean",
  },
  {
    type: "fill-na",
    icon: Droplets,
    label: "Fill Missing",
    description: "Impute nulls",
    group: "clean",
  },
  {
    type: "drop-column",
    icon: XCircle,
    label: "Drop Columns",
    description: "Remove columns",
    group: "clean",
  },
  {
    type: "drop-duplicates",
    icon: Copy,
    label: "Deduplicate",
    description: "Remove duplicate rows",
    group: "clean",
  },
  {
    type: "rename-column",
    icon: Type,
    label: "Rename",
    description: "Map column names",
    group: "clean",
  },
  {
    type: "filter-rows",
    icon: Filter,
    label: "Filter Rows",
    description: "Keep matching rows",
    group: "transform",
  },
  {
    type: "normalize",
    icon: Scale,
    label: "Normalize",
    description: "Scale numerics",
    group: "transform",
  },
  {
    type: "sort",
    icon: ArrowUpDown,
    label: "Sort",
    description: "Order by columns",
    group: "transform",
  },
  {
    type: "encode-categorical",
    icon: Tags,
    label: "Encode",
    description: "One-hot / label",
    group: "encode",
  },
];

const GROUP_META = {
  clean: { title: "Cleaning", dot: "bg-cat-cleaning", icon: "text-cat-cleaning" },
  transform: { title: "Transform", dot: "bg-cat-transform", icon: "text-cat-transform" },
  encode: { title: "Encode", dot: "bg-cat-encode", icon: "text-cat-encode" },
} as const;

function handleDragStart(
  event: DragEvent<HTMLDivElement>,
  type: NodeType,
  disabled: boolean,
): void {
  if (disabled) {
    event.preventDefault();
    return;
  }
  event.dataTransfer.setData("application/reactflow", type);
  event.dataTransfer.effectAllowed = "move";
}

export default function NodePalette({ onNodeAdded }: { onNodeAdded?: () => void }) {
  const nodeCount = usePipelineStore((state) => state.nodes.length);
  const addNode = usePipelineStore((state) => state.addNode);
  const isLargeFile = usePipelineStore((state) => state.isLargeFile);
  const isBlocked = (type: NodeType): boolean => isLargeFile && LARGE_BLOCKED_TYPES.has(type);
  const handleAdd = (type: NodeType): void => {
    if (isBlocked(type)) {
      toast.error(LARGE_BLOCKED_MESSAGE);
      return;
    }
    addNode(type, { x: 80 + (nodeCount % 4) * 60, y: 80 + nodeCount * 40 });
    onNodeAdded?.();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>, type: NodeType): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleAdd(type);
    }
  };

  const grouped = {
    clean: ITEMS.filter((i) => i.group === "clean"),
    transform: ITEMS.filter((i) => i.group === "transform"),
    encode: ITEMS.filter((i) => i.group === "encode"),
  };

  return (
    <div className="w-full space-y-4">
      {(Object.keys(grouped) as Array<keyof typeof grouped>).map((groupKey) => (
        <div key={groupKey}>
          <div className="mb-2 flex items-center gap-2 px-1">
            <div className={`h-1.5 w-1.5 shrink-0 rounded-full ${GROUP_META[groupKey].dot}`} />
            <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-ink3">
              {GROUP_META[groupKey].title}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
            {grouped[groupKey].map((item) => {
              const Icon = item.icon;
              const disabled = isBlocked(item.type);
              return (
                <div
                  key={item.type}
                  role="button"
                  tabIndex={disabled ? -1 : 0}
                  aria-disabled={disabled}
                  aria-label={`${item.label}: ${disabled ? LARGE_BLOCKED_MESSAGE : item.description}`}
                  draggable={!disabled}
                  onDragStart={(e) => handleDragStart(e, item.type, disabled)}
                  onClick={() => handleAdd(item.type)}
                  onKeyDown={(e) => handleKeyDown(e, item.type)}
                  title={disabled ? LARGE_BLOCKED_MESSAGE : "Drag onto canvas or tap"}
                  className={`group flex items-center gap-3 rounded-xl border border-transparent p-2.5 transition-colors ${
                    disabled
                      ? "cursor-not-allowed opacity-50 grayscale"
                      : "palette-node cursor-grab hover:border-line hover:bg-elevated/70 active:cursor-grabbing"
                  }`}
                >
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-elevated">
                    <Icon size={15} className={GROUP_META[groupKey].icon} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-bold leading-none tracking-tight text-ink">
                      {item.label}
                    </p>
                    <p className="mt-1 hidden text-[11px] font-medium leading-none text-ink3 lg:block">
                      {item.description}
                    </p>
                  </div>
                  <span className="ml-auto hidden text-ink3 transition-colors group-hover:text-accenttext lg:block">
                    ＋
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <p className="px-2 text-center text-[11px] leading-relaxed text-ink3">
        {isLargeFile
          ? "Large-file mode: Sort / Normalize / Encode are disabled — they need the full dataset."
          : "Drag onto canvas or tap. Connect nodes with arrows."}
      </p>
    </div>
  );
}
