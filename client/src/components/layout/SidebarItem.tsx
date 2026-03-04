import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui/Tooltip";
import type { ReactNode } from "react";

interface SidebarItemProps {
  icon: ReactNode;
  label: string;
  active?: boolean;
  collapsed?: boolean;
  badge?: number;
  onClick: () => void;
}

export function SidebarItem({ icon, label, active, collapsed, badge, onClick }: SidebarItemProps) {
  const content = (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer",
        "hover:bg-bg-overlay",
        active
          ? "bg-accent-subtle text-accent"
          : "text-text-secondary hover:text-text-primary",
        collapsed && "justify-center px-0"
      )}
    >
      <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
        {icon}
      </span>
      {!collapsed && (
        <>
          <span className="flex-1 text-left truncate">{label}</span>
          {badge !== undefined && badge > 0 && (
            <span className="flex-shrink-0 bg-error text-white text-[0.65rem] font-semibold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
              {badge > 99 ? "99+" : badge}
            </span>
          )}
        </>
      )}
      {collapsed && badge !== undefined && badge > 0 && (
        <span className="absolute -top-1 -right-1 bg-error text-white text-[0.6rem] font-semibold rounded-full min-w-[16px] h-4 flex items-center justify-center px-0.5">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );

  if (collapsed) {
    return (
      <div className="relative">
        <Tooltip content={label} side="right">
          {content}
        </Tooltip>
      </div>
    );
  }

  return content;
}
