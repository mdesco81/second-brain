import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { InboxQueueResponse, ProcessInboxPayload } from "@/types/api";
import { REFRESH_INTERVAL } from "@/lib/constants";

export function useInboxQueue() {
  return useQuery({
    queryKey: ["inbox-queue"],
    queryFn: () => api.get<InboxQueueResponse>("/api/inbox-queue"),
    refetchInterval: REFRESH_INTERVAL,
  });
}

export function useProcessInboxItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: ProcessInboxPayload }) =>
      api.post<{ ok: boolean; id: number; mode: string }>(
        `/api/inbox-queue/${id}/process`,
        payload
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["inbox-queue"] });
    },
  });
}
