import { useUIStore, type ActiveView } from "@/stores/ui-store";
import { useInboxQueue } from "@/hooks/use-inbox";
import { SidebarItem } from "./SidebarItem";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { cn } from "@/lib/cn";
import {
  LayoutDashboard,
  Columns3,
  PenLine,
  Users,
  PanelLeftClose,
  PanelLeft,
  Zap,
} from "lucide-react";

const navItems: Array<{ view: ActiveView; label: string; icon: React.ReactNode }> = [
  { view: "dashboard", label: "Foco", icon: <LayoutDashboard className="w-4.5 h-4.5" /> },
  { view: "kanban", label: "Kanban", icon: <Columns3 className="w-4.5 h-4.5" /> },
  { view: "jarbas", label: "Jarbas", icon: <PenLine className="w-4.5 h-4.5" /> },
  { view: "marta", label: "Marta", icon: <Users className="w-4.5 h-4.5" /> },
];

export function Sidebar() {
  const { activeView, setActiveView, sidebarCollapsed, toggleSidebar } = useUIStore();
  const { data: inboxData } = useInboxQueue();
  const inboxCount = inboxData?.count ?? 0;

  return (
    <TooltipProvider>
      <aside
        className={cn(
          "h-screen flex flex-col border-r border-border-subtle bg-bg-surface transition-all duration-200 flex-shrink-0",
          sidebarCollapsed ? "w-[var(--sidebar-collapsed)]" : "w-[var(--sidebar-width)]"
        )}
      >
        {/* Logo */}
        <div className={cn(
          "flex items-center gap-2.5 px-4 h-[var(--topbar-height)] border-b border-border-subtle flex-shrink-0",
          sidebarCollapsed && "justify-center px-0"
        )}>
          <Zap className="w-5 h-5 text-accent flex-shrink-0" />
          {!sidebarCollapsed && (
            <span className="font-semibold text-sm text-text-primary tracking-tight">Second Brain</span>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => (
            <SidebarItem
              key={item.view}
              icon={item.icon}
              label={item.label}
              active={activeView === item.view}
              collapsed={sidebarCollapsed}
              badge={item.view === "kanban" ? inboxCount : undefined}
              onClick={() => setActiveView(item.view)}
            />
          ))}
        </nav>

        {/* Collapse toggle */}
        <div className="px-2 py-3 border-t border-border-subtle flex-shrink-0">
          <button
            onClick={toggleSidebar}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-bg-overlay transition-colors cursor-pointer"
          >
            {sidebarCollapsed ? (
              <PanelLeft className="w-4 h-4" />
            ) : (
              <>
                <PanelLeftClose className="w-4 h-4" />
                <span className="text-xs">Recolher</span>
              </>
            )}
          </button>
        </div>
      </aside>
    </TooltipProvider>
  );
}
