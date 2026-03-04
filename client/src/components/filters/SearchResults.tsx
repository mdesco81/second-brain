import { useSearch } from "@/hooks/use-search";
import { useFilterStore } from "@/stores/filter-store";
import { useUIStore } from "@/stores/ui-store";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { truncate } from "@/lib/utils";
import { ArrowLeft, Search } from "lucide-react";

export function SearchResults() {
  const { searchQuery, setSearchQuery } = useFilterStore();
  const { data, isLoading } = useSearch(searchQuery);
  const { navigateToCard } = useUIStore();

  if (isLoading) {
    return (
      <div className="mt-4 space-y-2">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
      </div>
    );
  }

  const results = data?.results ?? [];
  const mode = data?.mode ?? "text";

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-text-primary">
          {results.length} resultado{results.length !== 1 ? "s" : ""} ({mode === "semantic" ? "sem\u00e2ntica" : "textual"})
        </h2>
        <Button size="sm" variant="ghost" onClick={() => setSearchQuery("")}>
          <ArrowLeft className="w-3.5 h-3.5" />
          Voltar ao kanban
        </Button>
      </div>

      {results.length === 0 ? (
        <EmptyState icon={<Search className="w-8 h-8" />} title="Nenhum resultado" description={`Nenhum card encontrado para "${searchQuery}"`} />
      ) : (
        <div className="space-y-2">
          {results.map((result) => (
            <button
              key={result.id}
              onClick={() => navigateToCard(result.id)}
              className="w-full text-left p-3 rounded-lg border border-border-default bg-bg-elevated hover:border-border-strong hover:shadow-md transition-all cursor-pointer"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary">
                    {result.actionTitle || truncate(result.summaryPtBr, 100)}
                  </p>
                  {result.actionTitle && (
                    <p className="text-xs text-text-tertiary mt-0.5 truncate">{truncate(result.summaryPtBr, 80)}</p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {result.score !== null && (
                    <Badge variant="accent">{Math.round(result.score * 100)}%</Badge>
                  )}
                  <Badge variant="muted">#{result.id}</Badge>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
