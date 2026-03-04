import { useUIStore } from "@/stores/ui-store";
import { Suspense, lazy } from "react";
import { Skeleton } from "@/components/ui/Skeleton";

const FocusDashboard = lazy(() => import("@/components/dashboard/FocusDashboard").then(m => ({ default: m.FocusDashboard })));
const KanbanBoard = lazy(() => import("@/components/kanban/KanbanBoard").then(m => ({ default: m.KanbanBoard })));
const JarbasView = lazy(() => import("@/components/jarbas/JarbasView").then(m => ({ default: m.JarbasView })));
const MartaView = lazy(() => import("@/components/marta/MartaView").then(m => ({ default: m.MartaView })));

function LoadingFallback() {
  return (
    <div className="p-6 space-y-4">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    </div>
  );
}

export function ContentArea() {
  const { activeView } = useUIStore();

  return (
    <Suspense fallback={<LoadingFallback />}>
      {activeView === "dashboard" && <FocusDashboard />}
      {activeView === "kanban" && <KanbanBoard />}
      {activeView === "jarbas" && <JarbasView />}
      {activeView === "marta" && <MartaView />}
    </Suspense>
  );
}
