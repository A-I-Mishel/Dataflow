import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

export default function EmptyState({ icon: Icon, title, description }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-5 py-10">
      <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-accent/20 to-accent2/20 border border-accent/20 grid place-items-center mb-4">
        <Icon size={28} className="text-accent" />
      </div>
      <p className="text-[15px] font-extrabold tracking-tight text-ink">{title}</p>
      <p className="text-sm text-ink3 mt-1.5 leading-relaxed max-w-[260px]">{description}</p>
    </div>
  );
}
