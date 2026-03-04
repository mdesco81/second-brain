import { useMemo, useState } from "react";
import { DndContext, DragOverlay, closestCorners, type DragStartEvent, type DragEndEvent, PointerSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import { useDashboard } from "@/hooks/use-dashboard";
import { useInboxQueue } from "@/hooks/use-inbox";
import { useUpdateStatus } from "@/hooks/use-actions";
import { useProcessInboxItem } from "@/hooks/use-inbox";
import { useFilterStore } from "@/stores/filter-store";
import { useUIStore } from "@/stores/ui-store";
import { useIsMobile } from "@/hooks/use-media-query";
import { useToast } from "@/components/ui/Toast";
import { KanbanColumn } from "./KanbanColumn";
import { KanbanCard } from "./KanbanCard";
import { CardDetail } from "./CardDetail";
import { FilterBar } from "@/components/filters/FilterBar";
import { SearchResults } from "@/components/filters/SearchResults";
import { Skeleton } from "@/components/ui/Skeleton";
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { priorityValue, truncate } from "@/lib/utils";
import { CheckCircle2, XCircle, RotateCcw, Pencil, Inbox, BookmarkPlus, Trash2, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import type { DashboardItem } from "@/types/api";

export function KanbanBoard() {
  const { data: dashboard, isLoading } = useDashboard();
  const { data: inboxData } = useInboxQueue();
  const { searchQuery } = useFilterStore();
  const updateStatus = useUpdateStatus();
  const processInbox = useProcessInboxItem();
  const { showToast } = useToast();
  const isMobile = useIsMobile();
  const { bottomSheetCardId, setBottomSheetCard, openEditModal } = useUIStore();
  const [activeCard, setActiveCard] = useState<DashboardItem | null>(null);
  const [openColumns, setOpenColumns] = useState<Set<string>>(new Set(["inbox", "open"]));

  const inboxIds = useMemo(() => {
    const set = new Set<number>();
    inboxData?.items?.forEach((item) => set.add(item.id));
    return set;
  }, [inboxData]);

  const { priority, category } = useFilterStore();

  const filteredItems = useMemo(() => {
    if (!dashboard?.recentItems) return [];
    let items = [...dashboard.recentItems];

    if (priority !== "all") {
      items = items.filter((i) => i.priority === priority);
    }
    if (category !== "all") {
      items = items.filter((i) => i.categoryName === category);
    }

    items.sort((a, b) => {
      const pDiff = priorityValue(b.priority) - priorityValue(a.priority);
      if (pDiff !== 0) return pDiff;
      if (a.dueAt && !b.dueAt) return -1;
      if (!a.dueAt && b.dueAt) return 1;
      if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return items;
  }, [dashboard?.recentItems, priority, category]);

  const grouped = useMemo(() => {
    const groups = { inbox: [] as DashboardItem[], open: [] as DashboardItem[], done: [] as DashboardItem[], eliminated: [] as DashboardItem[] };
    for (const item of filteredItems) {
      if (inboxIds.has(item.id) && item.status === "open") {
        groups.inbox.push(item);
      } else if (item.status === "open") {
        groups.open.push(item);
      } else if (item.status === "done") {
        groups.done.push(item);
      } else {
        groups.eliminated.push(item);
      }
    }
    return groups;
  }, [filteredItems, inboxIds]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  function handleDragStart(event: DragStartEvent) {
    const id = Number(event.active.id);
    const item = filteredItems.find((i) => i.id === id);
    setActiveCard(item || null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveCard(null);
    const { active, over } = event;
    if (!over) return;

    const cardId = Number(active.id);
    const targetStatus = String(over.id);
    const isInboxItem = inboxIds.has(cardId);

    if (targetStatus === "inbox") return;

    try {
      if (isInboxItem) {
        if (targetStatus === "eliminated") {
          await processInbox.mutateAsync({ id: cardId, payload: { mode: "trash" } });
          showToast("Item descartado", "success");
        } else {
          await processInbox.mutateAsync({ id: cardId, payload: { mode: "actionable" } });
          if (targetStatus === "done") {
            await updateStatus.mutateAsync({ id: cardId, status: "done" });
          }
          showToast("Item classificado como tarefa", "success");
        }
      } else {
        const statusMap: Record<string, "open" | "done" | "eliminated"> = {
          open: "open",
          done: "done",
          eliminated: "eliminated",
        };
        const newStatus = statusMap[targetStatus];
        if (newStatus) {
          await updateStatus.mutateAsync({ id: cardId, status: newStatus });
          const labels = { open: "Reaberto", done: "Resolvido", eliminated: "Eliminado" };
          showToast(labels[newStatus] || "Status atualizado", "success");
        }
      }
    } catch {
      showToast("Erro ao atualizar status", "error");
    }
  }

  // Bottom sheet item
  const bottomSheetItem = bottomSheetCardId ? filteredItems.find((i) => i.id === bottomSheetCardId) ?? null : null;
  const isBottomSheetInbox = bottomSheetItem ? inboxIds.has(bottomSheetItem.id) : false;

  async function handleBottomSheetStatus(status: "open" | "done" | "eliminated") {
    if (!bottomSheetItem) return;
    try {
      await updateStatus.mutateAsync({ id: bottomSheetItem.id, status });
      const labels = { open: "Reaberto", done: "Resolvido!", eliminated: "Eliminado" };
      showToast(labels[status], "success");
      setBottomSheetCard(null);
    } catch {
      showToast("Erro ao atualizar", "error");
    }
  }

  async function handleBottomSheetInbox(mode: "actionable" | "reference" | "trash") {
    if (!bottomSheetItem) return;
    try {
      await processInbox.mutateAsync({ id: bottomSheetItem.id, payload: { mode } });
      const labels = { actionable: "Marcado como tarefa", reference: "Salvo como referência", trash: "Descartado" };
      showToast(labels[mode], "success");
      setBottomSheetCard(null);
    } catch {
      showToast("Erro ao processar", "error");
    }
  }

  function toggleColumn(id: string) {
    setOpenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (searchQuery.length >= 3) {
    return (
      <div className="p-4 md:p-6">
        <FilterBar />
        <SearchResults />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4">
        <Skeleton className="h-10 w-full max-w-md" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-8 w-32" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const columns = [
    { id: "inbox", title: "A Processar", count: grouped.inbox.length, variant: "warning" as const, items: grouped.inbox },
    { id: "open", title: "Abertos", count: grouped.open.length, variant: "accent" as const, items: grouped.open },
    { id: "done", title: "Resolvidos", count: grouped.done.length, variant: "success" as const, items: grouped.done },
    { id: "eliminated", title: "Eliminados", count: grouped.eliminated.length, variant: "muted" as const, items: grouped.eliminated },
  ];

  return (
    <div className="p-4 md:p-6">
      <FilterBar />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {isMobile ? (
          /* Mobile: Accordion columns */
          <div className="mt-4 space-y-2">
            {columns.map((col) => {
              const isOpen = openColumns.has(col.id);
              const variantColors = {
                warning: "text-warning",
                accent: "text-accent",
                success: "text-success",
                muted: "text-text-tertiary",
              };
              return (
                <div key={col.id} className="rounded-lg border border-border-default bg-bg-surface overflow-hidden">
                  <button
                    onClick={() => toggleColumn(col.id)}
                    className="w-full flex items-center justify-between px-4 py-3 min-h-[48px]"
                  >
                    <div className="flex items-center gap-2">
                      <span className={cn("text-sm font-semibold", variantColors[col.variant])}>{col.title}</span>
                      <Badge variant={col.variant === "warning" ? "warning" : col.variant === "accent" ? "accent" : col.variant === "success" ? "success" : "muted"}>
                        {col.count}
                      </Badge>
                    </div>
                    <ChevronDown className={cn("w-4 h-4 text-text-tertiary transition-transform", isOpen && "rotate-180")} />
                  </button>
                  {isOpen && col.items.length > 0 && (
                    <div className="px-3 pb-3 space-y-2">
                      {col.items.map((item) => (
                        <KanbanCard key={item.id} item={item} />
                      ))}
                    </div>
                  )}
                  {isOpen && col.items.length === 0 && (
                    <p className="px-4 pb-3 text-xs text-text-tertiary">Nenhum item</p>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* Desktop: Grid columns */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
            {columns.map((col) => (
              <KanbanColumn key={col.id} id={col.id} title={col.title} count={col.count} variant={col.variant} items={col.items} />
            ))}
          </div>
        )}
        <DragOverlay>
          {activeCard && <KanbanCard item={activeCard} isDragging />}
        </DragOverlay>
      </DndContext>

      {/* Mobile Bottom Sheet for card detail */}
      <BottomSheet open={!!bottomSheetItem} onOpenChange={(open) => !open && setBottomSheetCard(null)}>
        {bottomSheetItem && (
          <>
            <BottomSheetHeader>
              <p className="text-sm font-semibold text-text-primary">
                {bottomSheetItem.actionTitle || truncate(bottomSheetItem.summaryPtBr, 60)}
              </p>
            </BottomSheetHeader>
            <BottomSheetBody>
              <CardDetail item={bottomSheetItem} />
              {/* Action buttons */}
              <div className="mt-4 pt-4 border-t border-border-subtle space-y-2">
                {isBottomSheetInbox ? (
                  <div className="grid grid-cols-3 gap-2">
                    <Button variant="primary" className="min-h-[44px]" onClick={() => handleBottomSheetInbox("actionable")}>
                      <BookmarkPlus className="w-4 h-4" /> Tarefa
                    </Button>
                    <Button variant="secondary" className="min-h-[44px]" onClick={() => handleBottomSheetInbox("reference")}>
                      <Inbox className="w-4 h-4" /> Referência
                    </Button>
                    <Button variant="danger" className="min-h-[44px]" onClick={() => handleBottomSheetInbox("trash")}>
                      <Trash2 className="w-4 h-4" /> Descartar
                    </Button>
                  </div>
                ) : bottomSheetItem.status === "open" ? (
                  <div className="grid grid-cols-3 gap-2">
                    <Button variant="success" className="min-h-[44px]" onClick={() => handleBottomSheetStatus("done")}>
                      <CheckCircle2 className="w-4 h-4" /> Resolver
                    </Button>
                    <Button variant="danger" className="min-h-[44px]" onClick={() => handleBottomSheetStatus("eliminated")}>
                      <XCircle className="w-4 h-4" /> Eliminar
                    </Button>
                    <Button variant="secondary" className="min-h-[44px]" onClick={() => { openEditModal(bottomSheetItem); setBottomSheetCard(null); }}>
                      <Pencil className="w-4 h-4" /> Editar
                    </Button>
                  </div>
                ) : (
                  <Button variant="secondary" className="w-full min-h-[44px]" onClick={() => handleBottomSheetStatus("open")}>
                    <RotateCcw className="w-4 h-4" /> Reabrir
                  </Button>
                )}
              </div>
            </BottomSheetBody>
          </>
        )}
      </BottomSheet>
    </div>
  );
}
