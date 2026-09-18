import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

export default function EmptyState({ icon: Icon, title, description }: EmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-5 py-10 text-center">
      <div className="bg-accentsoft mb-4 grid h-16 w-16 place-items-center rounded-2xl border border-accent/20">
        <Icon size={28} className="text-accenttext" />
      </div>
      <p className="text-[15px] font-extrabold tracking-tight text-ink">{title}</p>
      <p className="mt-1.5 max-w-[260px] text-sm leading-relaxed text-ink3">{description}</p>
    </div>
  );
}
