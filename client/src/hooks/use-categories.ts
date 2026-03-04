import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { CategoriesResponse } from "@/types/api";

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const data = await api.get<CategoriesResponse>("/api/categories");
      return data.categories;
    },
    staleTime: 60_000,
  });
}
