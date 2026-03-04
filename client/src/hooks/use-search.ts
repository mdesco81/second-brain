import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { api } from "@/lib/api-client";
import type { SearchResponse } from "@/types/api";
import { SEARCH_DEBOUNCE_MS, MIN_SEARCH_LENGTH } from "@/lib/constants";

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function useSearch(query: string) {
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);

  return useQuery({
    queryKey: ["search", debouncedQuery],
    queryFn: () =>
      api.get<SearchResponse>(
        `/api/search?q=${encodeURIComponent(debouncedQuery)}`
      ),
    enabled: debouncedQuery.length >= MIN_SEARCH_LENGTH,
  });
}
