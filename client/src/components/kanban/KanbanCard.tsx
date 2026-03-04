import { useDraggable } from "@dnd-kit/core";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/Badge";
import { useUIStore } from "@/stores/ui-store";
import { useIsMobile } from "@/hooks/use-media-query";
import { useUpdateStatus } from "@/hooks/use-actions";
import { useProcessInboxItem, useInboxQueue } from "@/hooks/use-inbox";
import { useToast } from "@/components/ui/Toast";
import { useSwipe } from "@/hooks/use-swipe";
import { daysFromNow, truncate } from "@/lib/utils";
import { CheckCircle2, XCircle, RotateCcw, Pencil, Inbox, BookmarkPlus, Trash2 } from "lucide-react";
import { CardDetail } from "./CardDetail";
import { useState } from "react";
import type { DashboardItem } from "@/types/api";

interface KanbanCardProps {
  item: DashboardItem;
  isDragging?: boolean;
}

export function KanbanCard({ item, isDragging }: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: item.id });
  const { expandedCardId, setExpandedCard, openEditModal, setBottomSheetCard } = useUIStore();
  const isMobile = useIsMobile();
  const updateStatus = useUpdateStatus();
  const processInbox = useProcessInboxItem();
  const { data: inboxData } = useInboxQueue();
  const { showToast } = useToast();
  const isExpanded = expandedCardId === item.id;
  const isInbox = inboxData?.items?.some((i) => i.id === item.id) ?? false;
  const [swipeHint, setSwipeHint] = useState<"left" | "right" | null>(null);

  const days = daysFromNow(item.dueAt);
  const isOverdue = days !== null && days < 0;
  const isDueToday = days === 0;

  const priorityBorder =
    item.priority === "ALTA" ? "border-l-error" : item.priority === "MEDIA" ? "border-l-warning" : "border-l-success";

  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;

  const swipeHandlers = useSwipe({
    onSwipeRight: async () => {
      if (item.status === "open" && !isInbox) {
        try {
          await updateStatus.mutateAsync({ id: item.id, status: "done" });
          showToast("Resolvido!", "success");
        } catch {
          showToast("Erro ao atualizar", "error");
        }
      }
    },
    onSwipeLeft: async () => {
      if (item.status === "open" && !isInbox) {
        try {
          await updateStatus.mutateAsync({ id: item.id, status: "eliminated" });
          showToast("Eliminado", "success");
        } catch {
          showToast("Erro ao atualizar", "error");
        }
      } else if (item.status === "done" || item.status === "eliminated") {
        try {
          await updateStatus.mutateAsync({ id: item.id, status: "open" });
          showToast("Reaberto", "success");
        } catch {
          showToast("Erro ao atualizar", "error");
        }
      }
    },
  });

  function handleClick(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest("button")) return;
    if (isMobile) {
      setBottomSheetCard(item.id);
    } else {
      setExpandedCard(isExpanded ? null : item.id);
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      {...(isMobile ? swipeHandlers : {})}
      onClick={handleClick}
      className={cn(
        "rounded-lg border border-border-default bg-bg-elevated p-3 border-l-[3px] cursor-pointer transition-all duration-150 group",
        "hover:shadow-md hover:border-border-strong",
        "min-h-[44px]",
        priorityBorder,
        isDragging && "opacity-50 shadow-lg scale-[0.97]",
        isExpanded && "ring-1 ring-accent/30",
        swipeHint === "right" && "bg-success-subtle",
        swipeHint === "left" && "bg-error-subtle"
      )}
    >
      {/* Progressive Layer 3 */}
      {item.progressive?.layer3 && (
        <p className="text-[0.7rem] text-accent mb-1 font-medium">{item.progressive.layer3}</p>
      )}

      {/* Title */}
      <p className="text-sm font-medium text-text-primary leading-snug">
        {item.actionTitle || truncate(item.summaryPtBr, 80)}
      </p>

      {/* Meta tags */}
      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        {item.categoryName && <Badge variant="muted">{item.categoryName}</Badge>}
        {isOverdue && <Badge variant="error">Atrasado {Math.abs(days!)}d</Badge>}
        {isDueToday && <Badge variant="warning">Hoje</Badge>}
        {!isOverdue && !isDueToday && item.dueAt && days !== null && days > 0 && days <= 3 && (
          <Badge variant="warning">{days}d</Badge>
        )}
      </div>

      {/* Hover actions - desktop */}
      {!isMobile && (
        <div className="hidden group-hover:flex items-center gap-1 mt-2 pt-2 border-t border-border-subtle">
          {isInbox ? (
            <>
              <ActionBtn icon={<BookmarkPlus className="w-3.5 h-3.5" />} label="Tarefa" onClick={() => handleInboxProcess("actionable")} />
              <ActionBtn icon={<Inbox className="w-3.5 h-3.5" />} label="Referência" onClick={() => handleInboxProcess("reference")} />
              <ActionBtn icon={<Trash2 className="w-3.5 h-3.5" />} label="Descartar" onClick={() => handleInboxProcess("trash")} danger />
            </>
          ) : item.status === "open" ? (
            <>
              <ActionBtn icon={<CheckCircle2 className="w-3.5 h-3.5" />} label="Resolver" onClick={() => handleStatusChange("done")} />
              <ActionBtn icon={<XCircle className="w-3.5 h-3.5" />} label="Eliminar" onClick={() => handleStatusChange("eliminated")} />
              <ActionBtn icon={<Pencil className="w-3.5 h-3.5" />} label="Editar" onClick={() => openEditModal(item)} />
            </>
          ) : (
            <ActionBtn icon={<RotateCcw className="w-3.5 h-3.5" />} label="Reabrir" onClick={() => handleStatusChange("open")} />
          )}
        </div>
      )}

      {/* Expanded detail - desktop only */}
      {isExpanded && !isMobile && <CardDetail item={item} />}
    </div>
  );

  async function handleStatusChange(status: "open" | "done" | "eliminated") {
    try {
      await updateStatus.mutateAsync({ id: item.id, status });
      const labels = { open: "Reaberto", done: "Resolvido!", eliminated: "Eliminado" };
      showToast(labels[status], "success");
    } catch {
      showToast("Erro ao atualizar", "error");
    }
  }

  async function handleInboxProcess(mode: "actionable" | "reference" | "trash") {
    try {
      await processInbox.mutateAsync({ id: item.id, payload: { mode } });
      const labels = { actionable: "Marcado como tarefa", reference: "Salvo como referência", trash: "Descartado" };
      showToast(labels[mode], "success");
    } catch {
      showToast("Erro ao processar", "error");
    }
  }
}

function ActionBtn({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={cn(
        "flex items-center gap-1 px-2 py-1 rounded-md text-[0.7rem] font-medium transition-colors min-h-[44px] md:min-h-0",
        danger
          ? "text-text-tertiary hover:text-error hover:bg-error-subtle"
          : "text-text-tertiary hover:text-text-primary hover:bg-bg-overlay"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
