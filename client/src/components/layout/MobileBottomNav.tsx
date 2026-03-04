import { useUIStore, type ActiveView } from "@/stores/ui-store";
import { useInboxQueue } from "@/hooks/use-inbox";
import { cn } from "@/lib/cn";
import { LayoutDashboard, Columns3, PenLine, Users } from "lucide-react";

const navItems: Array<{ view: ActiveView; label: string; icon: React.ReactNode }> = [
  { view: "dashboard", label: "Foco", icon: <LayoutDashboard className="w-5 h-5" /> },
  { view: "kanban", label: "Kanban", icon: <Columns3 className="w-5 h-5" /> },
  { view: "jarbas", label: "Jarbas", icon: <PenLine className="w-5 h-5" /> },
  { view: "marta", label: "Marta", icon: <Users className="w-5 h-5" /> },
];

export function MobileBottomNav() {
  const { activeView, setActiveView } = useUIStore();
  const { data: inboxData } = useInboxQueue();
  const inboxCount = inboxData?.count ?? 0;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 h-[var(--bottom-nav-height)] bg-bg-surface/95 backdrop-blur-md border-t border-border-subtle pb-safe">
      <div className="flex items-center justify-around h-full max-w-lg mx-auto">
        {navItems.map((item) => (
          <button
            key={item.view}
            onClick={() => setActiveView(item.view)}
            className={cn(
              "flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-lg transition-colors cursor-pointer min-w-[60px] min-h-[44px]",
              activeView === item.view
                ? "text-accent"
                : "text-text-tertiary active:text-text-secondary"
            )}
          >
            <div className="relative">
              {item.icon}
              {item.view === "kanban" && inboxCount > 0 && (
                <span className="absolute -top-1.5 -right-2.5 bg-error text-white text-[0.55rem] font-bold rounded-full min-w-[15px] h-[15px] flex items-center justify-center px-0.5">
                  {inboxCount > 99 ? "99+" : inboxCount}
                </span>
              )}
            </div>
            <span className="text-[0.65rem] font-medium">{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
