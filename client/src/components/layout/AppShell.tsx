import { useIsMobile } from "@/hooks/use-media-query";
import { useUIStore } from "@/stores/ui-store";
import { Sidebar } from "./Sidebar";
import { MobileBottomNav } from "./MobileBottomNav";
import { TopBar } from "./TopBar";
import { ContentArea } from "./ContentArea";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { cn } from "@/lib/cn";

export function AppShell() {
  const isMobile = useIsMobile();
  const { sidebarOpen, setSidebarOpen } = useUIStore();

  return (
    <TooltipProvider>
      <div className="flex h-screen overflow-hidden bg-bg-base">
        {!isMobile && <Sidebar />}

        {/* Mobile sidebar overlay */}
        {isMobile && (
          <>
            <div
              className={cn(
                "fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-200",
                sidebarOpen ? "opacity-100" : "opacity-0 pointer-events-none"
              )}
              onClick={() => setSidebarOpen(false)}
            />
            <div
              className={cn(
                "fixed inset-y-0 left-0 z-50 w-[var(--sidebar-width)] transition-transform duration-200",
                sidebarOpen ? "translate-x-0" : "-translate-x-full"
              )}
            >
              <Sidebar mobile onNavigate={() => setSidebarOpen(false)} />
            </div>
          </>
        )}

        <div className="flex-1 flex flex-col overflow-hidden">
          <TopBar />
          <main className={`flex-1 overflow-y-auto ${isMobile ? "pb-[var(--bottom-nav-height)]" : ""}`}>
            <ContentArea />
          </main>
        </div>
        {isMobile && <MobileBottomNav />}
      </div>
    </TooltipProvider>
  );
}
