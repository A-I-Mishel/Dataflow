import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

export default function EmptyState({ icon: Icon, title, description }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-slate-500">
      <Icon size={48} className="mb-4" />
      <p className="text-lg font-medium text-slate-400">{title}</p>
      <p className="text-sm">{description}</p>
    </div>
  );
}
