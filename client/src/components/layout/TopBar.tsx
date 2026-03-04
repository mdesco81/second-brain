import { useFilterStore } from "@/stores/filter-store";
import { useUIStore } from "@/stores/ui-store";
import { useIsMobile } from "@/hooks/use-media-query";
import { cn } from "@/lib/cn";
import { Search, Menu, Zap } from "lucide-react";
import { useRef } from "react";

export function TopBar() {
  const isMobile = useIsMobile();
  const { searchQuery, setSearchQuery } = useFilterStore();
  const { setSidebarOpen } = useUIStore();
  const inputRef = useRef<HTMLInputElement>(null);

  if (isMobile) {
    return (
      <header className="flex items-center gap-3 h-[var(--topbar-height)] px-4 border-b border-border-subtle bg-bg-surface/80 backdrop-blur-md sticky top-0 z-30">
        <button
          onClick={() => setSidebarOpen(true)}
          className="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-overlay transition-colors"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2 flex-1">
          <Zap className="w-4 h-4 text-accent" />
          <span className="font-semibold text-sm text-text-primary">Second Brain</span>
        </div>
        <button
          onClick={() => inputRef.current?.focus()}
          className="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-overlay transition-colors"
        >
          <Search className="w-5 h-5" />
        </button>
      </header>
    );
  }

  return (
    <header className="flex items-center gap-4 h-[var(--topbar-height)] px-6 border-b border-border-subtle sticky top-0 z-30 bg-bg-base/80 backdrop-blur-md">
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
        <input
          ref={inputRef}
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Buscar cards..."
          className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-border-default bg-bg-surface text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-colors"
        />
      </div>
    </header>
  );
}
