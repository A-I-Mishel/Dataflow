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
  group: 'clean' | 'transform' | 'encode';
}

const ITEMS: PaletteItem[] = [
  { type: 'drop-na', icon: Trash2, label: 'Drop Missing', description: 'Remove rows with nulls', group: 'clean' },
  { type: 'fill-na', icon: Droplets, label: 'Fill Missing', description: 'Impute nulls', group: 'clean' },
  { type: 'drop-column', icon: XCircle, label: 'Drop Columns', description: 'Remove columns', group: 'clean' },
  { type: 'rename-column', icon: Type, label: 'Rename', description: 'Map column names', group: 'clean' },
  { type: 'filter-rows', icon: Filter, label: 'Filter Rows', description: 'Keep matching rows', group: 'transform' },
  { type: 'normalize', icon: Scale, label: 'Normalize', description: 'Scale numerics', group: 'transform' },
  { type: 'sort', icon: ArrowUpDown, label: 'Sort', description: 'Order by columns', group: 'transform' },
  { type: 'encode-categorical', icon: Tags, label: 'Encode', description: 'One-hot / label', group: 'encode' },
];

const GROUP_META = {
  clean: { title: 'Cleaning', color: 'from-sky-500 to-indigo-500' },
  transform: { title: 'Transform', color: 'from-violet-500 to-fuchsia-500' },
  encode: { title: 'Encode', color: 'from-amber-500 to-orange-500' },
} as const;

function handleDragStart(event: DragEvent<HTMLDivElement>, type: NodeType): void {
  event.dataTransfer.setData('application/reactflow', type);
  event.dataTransfer.effectAllowed = 'move';
}

export default function NodePalette({ onNodeAdded }: { onNodeAdded?: () => void }) {
  const nodeCount = usePipelineStore((state) => state.nodes.length);
  const addNode = usePipelineStore((state) => state.addNode);
  const handleAdd = (type: NodeType): void => {
    addNode(type, { x: 80 + (nodeCount % 4) * 60, y: 80 + nodeCount * 40 });
    onNodeAdded?.();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>, type: NodeType): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleAdd(type);
    }
  };

  const grouped = {
    clean: ITEMS.filter((i) => i.group === 'clean'),
    transform: ITEMS.filter((i) => i.group === 'transform'),
    encode: ITEMS.filter((i) => i.group === 'encode'),
  };

  return (
    <div className="w-full space-y-4">
      {(Object.keys(grouped) as Array<keyof typeof grouped>).map((groupKey) => (
        <div key={groupKey}>
          <div className="flex items-center gap-2 px-1 mb-2">
            <div className={`h-1 w-6 rounded-full bg-gradient-to-r ${GROUP_META[groupKey].color}`} />
            <p className="text-[11px] font-extrabold tracking-[0.14em] text-ink3 uppercase">{GROUP_META[groupKey].title}</p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-1 gap-2">
            {grouped[groupKey].map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.type}
                  role="button"
                  tabIndex={0}
                  draggable
                  onDragStart={(e) => handleDragStart(e, item.type)}
                  onClick={() => handleAdd(item.type)}
                  onKeyDown={(e) => handleKeyDown(e, item.type)}
                  title="Drag onto canvas or tap"
                  className="group flex items-center gap-3 p-3 rounded-2xl bg-card border border-white/[0.06] hover:border-accent/30 hover:bg-elevated cursor-grab active:cursor-grabbing transition-all hover:shadow-lg hover:-translate-y-0.5"
                >
                  <div
                    className={`h-9 w-9 rounded-xl grid place-items-center shrink-0 bg-gradient-to-br ${GROUP_META[groupKey].color} shadow-md group-hover:shadow-lg transition-shadow`}
                  >
                    <Icon size={16} className="text-white" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-bold tracking-tight text-ink leading-none">{item.label}</p>
                    <p className="text-[11px] font-medium text-ink3 mt-1 leading-none hidden lg:block">{item.description}</p>
                  </div>
                  <span className="ml-auto hidden lg:block text-ink3 group-hover:text-accent transition-colors">＋</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <p className="text-[11px] text-center text-ink3 px-2 leading-relaxed">Drag onto canvas or tap. Connect nodes with arrows.</p>
    </div>
  );
}
