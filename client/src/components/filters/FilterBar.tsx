import { useFilterStore } from "@/stores/filter-store";
import { useDashboard } from "@/hooks/use-dashboard";
import { Chip } from "@/components/ui/Chip";
import { Select, SelectItem } from "@/components/ui/Select";
import type { ActionPriority } from "@/types/api";

const priorityFilters: Array<{ value: ActionPriority | "all"; label: string; variant: "default" | "alta" | "media" | "baixa" }> = [
  { value: "all", label: "Todas", variant: "default" },
  { value: "ALTA", label: "Alta", variant: "alta" },
  { value: "MEDIA", label: "M\u00e9dia", variant: "media" },
  { value: "BAIXA", label: "Baixa", variant: "baixa" },
];

export function FilterBar() {
  const { priority, category, setPriority, setCategory } = useFilterStore();
  const { data: dashboard } = useDashboard();
  const categories = dashboard?.categories ?? [];

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1.5">
        {priorityFilters.map((f) => (
          <Chip
            key={f.value}
            active={priority === f.value}
            variant={f.variant}
            onClick={() => setPriority(f.value)}
          >
            {f.label}
          </Chip>
        ))}
      </div>
      <Select value={category} onValueChange={setCategory} className="w-44">
        <SelectItem value="all">Todas categorias</SelectItem>
        {categories.map((cat) => (
          <SelectItem key={cat.name} value={cat.name}>
            {cat.name} ({cat.total})
          </SelectItem>
        ))}
      </Select>
    </div>
  );
}
