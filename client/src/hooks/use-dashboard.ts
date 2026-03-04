import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { DashboardSummary } from "@/types/api";
import { REFRESH_INTERVAL } from "@/lib/constants";

export function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardSummary>("/api/dashboard"),
    refetchInterval: REFRESH_INTERVAL,
  });
}
