import { useIsMobile } from "@/hooks/use-media-query";
import { Sidebar } from "./Sidebar";
import { MobileBottomNav } from "./MobileBottomNav";
import { TopBar } from "./TopBar";
import { ContentArea } from "./ContentArea";
import { TooltipProvider } from "@/components/ui/Tooltip";

export function AppShell() {
  const isMobile = useIsMobile();

  return (
    <TooltipProvider>
      <div className="flex h-screen overflow-hidden bg-bg-base">
        {!isMobile && <Sidebar />}
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
