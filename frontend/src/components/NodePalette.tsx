import { ArrowUpDown } from 'lucide-react';
import { Droplets } from 'lucide-react';
import { Filter } from 'lucide-react';
import { Scale } from 'lucide-react';
import { Tags } from 'lucide-react';
import { Trash2 } from 'lucide-react';
import { Type } from 'lucide-react';
import { XCircle } from 'lucide-react';
import type { DragEvent, KeyboardEvent } from 'react';
import type { LucideIcon } from 'lucide-react';

import { usePipelineStore } from '../stores/pipelineStore';
import type { NodeType } from '../types';

interface PaletteItem {
  type: NodeType;
  icon: LucideIcon;
  label: string;
  description: string;
  borderClass: string;
  iconClass: string;
}

const CLEANING_BORDER = 'border-blue-500';
const CLEANING_ICON = 'text-blue-400';
const TRANSFORM_BORDER = 'border-purple-500';
const TRANSFORM_ICON = 'text-purple-400';
const ENCODE_BORDER = 'border-orange-500';
const ENCODE_ICON = 'text-orange-400';

const ITEMS: PaletteItem[] = [
  {
    type: 'drop-na',
    icon: Trash2,
    label: 'Drop Missing',
    description: 'Remove rows with missing values',
    borderClass: CLEANING_BORDER,
    iconClass: CLEANING_ICON,
  },
  {
    type: 'fill-na',
    icon: Droplets,
    label: 'Fill Missing',
    description: 'Fill nulls with strategy',
    borderClass: CLEANING_BORDER,
    iconClass: CLEANING_ICON,
  },
  {
    type: 'drop-column',
    icon: XCircle,
    label: 'Drop Columns',
    description: 'Remove selected columns',
    borderClass: CLEANING_BORDER,
    iconClass: CLEANING_ICON,
  },
  {
    type: 'rename-column',
    icon: Type,
    label: 'Rename Columns',
    description: 'Rename columns with mapping',
    borderClass: CLEANING_BORDER,
    iconClass: CLEANING_ICON,
  },
  {
    type: 'filter-rows',
    icon: Filter,
    label: 'Filter Rows',
    description: 'Keep rows matching conditions',
    borderClass: TRANSFORM_BORDER,
    iconClass: TRANSFORM_ICON,
  },
  {
    type: 'normalize',
    icon: Scale,
    label: 'Normalize',
    description: 'Scale numeric columns',
    borderClass: TRANSFORM_BORDER,
    iconClass: TRANSFORM_ICON,
  },
  {
    type: 'encode-categorical',
    icon: Tags,
    label: 'Encode Categories',
    description: 'One-hot or label encode',
    borderClass: ENCODE_BORDER,
    iconClass: ENCODE_ICON,
  },
  {
    type: 'sort',
    icon: ArrowUpDown,
    label: 'Sort',
    description: 'Sort by columns',
    borderClass: TRANSFORM_BORDER,
    iconClass: TRANSFORM_ICON,
  },
];

function handleDragStart(event: DragEvent<HTMLDivElement>, type: NodeType): void {
  event.dataTransfer.setData('application/reactflow', type);
  event.dataTransfer.effectAllowed = 'move';
}

export default function NodePalette({
  onNodeAdded,
}: {
  onNodeAdded?: () => void;
}) {
  // Touch screens never fire HTML5 drag events, so tapping an item must also
  // add the node (desktop drag-and-drop is untouched).
  const nodeCount = usePipelineStore((state) => state.nodes.length);
  const addNode = usePipelineStore((state) => state.addNode);

  const handleAdd = (type: NodeType): void => {
    addNode(type, {
      x: 80 + (nodeCount % 4) * 60,
      y: 80 + nodeCount * 40,
    });
    onNodeAdded?.();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>, type: NodeType): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleAdd(type);
    }
  };

  return (
    <div className="w-full">
      {/* Mobile: touch-friendly 2-column grid. Desktop (lg): single-column list. */}
      <div className="grid grid-cols-2 lg:grid-cols-1 gap-2 p-3">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.type}
              role="button"
              tabIndex={0}
              draggable={true}
              onDragStart={(event) => handleDragStart(event, item.type)}
              onClick={() => handleAdd(item.type)}
              onKeyDown={(event) => handleKeyDown(event, item.type)}
              title="Drag onto the canvas, or tap to add"
              className={`flex items-center gap-3 p-3 min-h-[3.5rem] rounded-lg bg-slate-800 hover:bg-slate-750 cursor-grab active:cursor-grabbing transition-colors border-l-4 ${item.borderClass}`}
            >
              <Icon size={20} className={`${item.iconClass} shrink-0`} />
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-200 truncate">{item.label}</p>
                <p className="text-xs text-slate-500 hidden lg:block">
                  {item.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
