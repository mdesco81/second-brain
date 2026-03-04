import { useUIStore } from "@/stores/ui-store";
import { Suspense, lazy, Component, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { AlertTriangle } from "lucide-react";

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

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center p-8 gap-4 text-center">
          <AlertTriangle className="w-10 h-10 text-warning" />
          <p className="text-sm text-text-primary font-medium">Algo deu errado ao carregar esta view</p>
          <p className="text-xs text-text-tertiary max-w-md">{this.state.error.message}</p>
          <Button variant="secondary" onClick={() => this.setState({ error: null })}>
            Tentar novamente
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function ContentArea() {
  const { activeView } = useUIStore();

  return (
    <ErrorBoundary key={activeView}>
      <Suspense fallback={<LoadingFallback />}>
        {activeView === "dashboard" && <FocusDashboard />}
        {activeView === "kanban" && <KanbanBoard />}
        {activeView === "jarbas" && <JarbasView />}
        {activeView === "marta" && <MartaView />}
      </Suspense>
    </ErrorBoundary>
  );
}
