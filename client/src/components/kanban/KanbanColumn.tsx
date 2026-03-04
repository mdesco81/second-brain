import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/cn";
import { KanbanCard } from "./KanbanCard";
import { EmptyState } from "@/components/ui/EmptyState";
import type { DashboardItem } from "@/types/api";

interface KanbanColumnProps {
  id: string;
  title: string;
  count: number;
  variant: "warning" | "accent" | "success" | "muted";
  items: DashboardItem[];
}

const variantStyles: Record<string, string> = {
  warning: "text-warning",
  accent: "text-accent",
  success: "text-success",
  muted: "text-text-tertiary",
};

export function KanbanColumn({ id, title, count, variant, items }: KanbanColumnProps) {
  const { isOver, setNodeRef } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col rounded-xl bg-bg-surface border border-border-subtle min-h-[200px] transition-colors",
        isOver && "border-accent bg-accent-subtle/30"
      )}
    >
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border-subtle">
        <h3 className={cn("text-xs font-semibold uppercase tracking-wider", variantStyles[variant])}>
          {title}
        </h3>
        <span className="text-[0.65rem] font-medium text-text-tertiary bg-bg-overlay rounded-full px-2 py-0.5">
          {count}
        </span>
      </div>
      <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[calc(100vh-220px)]">
        {items.length === 0 ? (
          <EmptyState title="Nenhum item" className="py-8" />
        ) : (
          items.map((item) => <KanbanCard key={item.id} item={item} />)
        )}
      </div>
    </div>
  );
}
