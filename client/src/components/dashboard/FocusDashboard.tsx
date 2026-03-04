import { useDashboard } from "@/hooks/use-dashboard";
import { useInboxQueue } from "@/hooks/use-inbox";
import { useUIStore } from "@/stores/ui-store";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/cn";
import { daysFromNow, truncate } from "@/lib/utils";
import {
  AlertTriangle,
  Clock,
  UserX,
  Plus,
  Inbox,
  ArrowRight,
  TrendingUp,
  CheckCircle2,
  Archive,
  Layers,
} from "lucide-react";

export function FocusDashboard() {
  const { data: dashboard, isLoading } = useDashboard();
  const { data: inboxData } = useInboxQueue();
  const { setActiveView, setCreateModalOpen, navigateToCard } = useUIStore();

  if (isLoading || !dashboard) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <Skeleton className="h-48" />
      </div>
    );
  }

  const { alerts, statusBreakdown, todayFocus, focusItems, totalItems, openActions, totalProjects } = dashboard;
  const inboxCount = inboxData?.count ?? 0;
  const hasAlerts = alerts.overdue > 0 || alerts.dueToday > 0 || alerts.missingOwner > 0;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl">
      {/* Alerts Banner */}
      {hasAlerts && (
        <div className="flex flex-wrap gap-2">
          {alerts.overdue > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-error-subtle text-error text-xs font-medium">
              <AlertTriangle className="w-3.5 h-3.5" />
              {alerts.overdue} atrasado{alerts.overdue > 1 ? "s" : ""}
            </div>
          )}
          {alerts.dueToday > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-warning-subtle text-warning text-xs font-medium">
              <Clock className="w-3.5 h-3.5" />
              {alerts.dueToday} vence{alerts.dueToday > 1 ? "m" : ""} hoje
            </div>
          )}
          {alerts.missingOwner > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-info-subtle text-info text-xs font-medium">
              <UserX className="w-3.5 h-3.5" />
              {alerts.missingOwner} sem responsável
            </div>
          )}
        </div>
      )}

      {/* Stats Strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard icon={<Layers className="w-4 h-4" />} label="Capturados" value={totalItems} />
        <StatCard icon={<TrendingUp className="w-4 h-4" />} label="Abertos" value={openActions} accent />
        <StatCard icon={<CheckCircle2 className="w-4 h-4" />} label="Resolvidos" value={statusBreakdown.done} />
        <StatCard icon={<Archive className="w-4 h-4" />} label="Eliminados" value={statusBreakdown.eliminated} />
        <StatCard icon={<Layers className="w-4 h-4" />} label="Projetos" value={totalProjects} />
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-3">
        <Button variant="primary" onClick={() => setCreateModalOpen(true)}>
          <Plus className="w-4 h-4" />
          Novo card
        </Button>
        {inboxCount > 0 && (
          <Button variant="secondary" onClick={() => setActiveView("kanban")}>
            <Inbox className="w-4 h-4" />
            Processar inbox
            <Badge variant="error">{inboxCount}</Badge>
          </Button>
        )}
      </div>

      {/* Today's Focus */}
      {todayFocus.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-accent" />
            Foco de hoje
          </h2>
          <div className="space-y-2">
            {todayFocus.map((item) => (
              <FocusCard
                key={item.id}
                id={item.id}
                title={item.summaryPtBr}
                priority={item.priority}
                dueAt={item.dueAt}
                category={item.categoryName}
                nextStep={item.nextStep}
                onClick={() => navigateToCard(item.id)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Priority Items */}
      {focusItems.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-error" />
              Alta prioridade
            </h2>
            <button
              onClick={() => setActiveView("kanban")}
              className="text-xs text-text-tertiary hover:text-accent flex items-center gap-1 transition-colors"
            >
              Ver todos <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="space-y-2">
            {focusItems.slice(0, 5).map((item) => (
              <FocusCard
                key={item.id}
                id={item.id}
                title={item.summaryPtBr}
                priority={item.priority}
                dueAt={item.dueAt}
                category={item.categoryName}
                onClick={() => navigateToCard(item.id)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Inbox Preview */}
      {inboxCount > 0 && (
        <section className="rounded-lg border border-border-default bg-bg-surface p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Inbox className="w-4 h-4 text-warning" />
              <span className="text-sm font-medium text-text-primary">
                {inboxCount} item{inboxCount > 1 ? "s" : ""} para processar
              </span>
            </div>
            <Button size="sm" variant="secondary" onClick={() => setActiveView("kanban")}>
              Processar
              <ArrowRight className="w-3 h-3" />
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-surface p-3">
      <div className="flex items-center gap-2 mb-1">
        <span className={cn("text-text-tertiary", accent && "text-accent")}>{icon}</span>
        <span className="text-xs text-text-tertiary">{label}</span>
      </div>
      <span className={cn("text-xl font-semibold", accent ? "text-accent" : "text-text-primary")}>
        {value}
      </span>
    </div>
  );
}

interface FocusCardProps {
  id: number;
  title: string;
  priority: string;
  dueAt?: string;
  category: string;
  nextStep?: string;
  onClick: () => void;
}

function FocusCard({ id, title, priority, dueAt, category, nextStep, onClick }: FocusCardProps) {
  const days = daysFromNow(dueAt);
  const isOverdue = days !== null && days < 0;
  const isDueToday = days === 0;

  const priorityColor = priority === "ALTA" ? "border-l-error" : priority === "MEDIA" ? "border-l-warning" : "border-l-success";

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-lg border border-border-default bg-bg-elevated p-3 border-l-[3px] transition-all duration-150",
        "hover:shadow-md hover:border-border-strong cursor-pointer",
        priorityColor
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-text-primary truncate">{truncate(title, 80)}</p>
          {nextStep && (
            <p className="text-xs text-text-tertiary mt-0.5 truncate">{"\u2192"} {nextStep}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {category && <Badge variant="muted">{category}</Badge>}
          {isOverdue && <Badge variant="error">Atrasado</Badge>}
          {isDueToday && <Badge variant="warning">Hoje</Badge>}
        </div>
      </div>
    </button>
  );
}
