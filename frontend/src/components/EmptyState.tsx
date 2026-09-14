import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

export default function EmptyState({ icon: Icon, title, description }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center text-ink3 px-4 py-8">
      <span className="rounded-full bg-btn p-4 mb-4">
        <Icon size={40} />
      </span>
      <p className="text-lg font-medium text-ink2">{title}</p>
      <p className="text-sm mt-1">{description}</p>
    </div>
  );
}
