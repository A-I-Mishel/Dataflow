import { ArrowUpDown } from 'lucide-react';
import { Droplets } from 'lucide-react';
import { Filter } from 'lucide-react';
import { Scale } from 'lucide-react';
import { Tags } from 'lucide-react';
import { Trash2 } from 'lucide-react';
import { Type } from 'lucide-react';
import { XCircle } from 'lucide-react';
import type { DragEvent } from 'react';
import type { LucideIcon } from 'lucide-react';

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

export default function NodePalette() {
  return (
    <div className="w-full">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2 p-3">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.type}
              draggable={true}
              onDragStart={(event) => handleDragStart(event, item.type)}
              className={`flex items-center gap-3 p-3 rounded-lg bg-slate-800 hover:bg-slate-750 cursor-grab active:cursor-grabbing transition-colors border-l-4 ${item.borderClass}`}
            >
              <Icon size={20} className={item.iconClass} />
              <div>
                <p className="text-sm font-medium text-slate-200">{item.label}</p>
                <p className="text-xs text-slate-500">{item.description}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
