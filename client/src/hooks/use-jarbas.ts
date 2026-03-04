import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { AgentOutputsResponse } from "@/types/api";

export function useAgentOutputs() {
  return useQuery({
    queryKey: ["agent-outputs"],
    queryFn: async () => {
      const data = await api.get<AgentOutputsResponse>("/api/agent-outputs");
      return data.outputs;
    },
  });
}

export function useFileContent(itemId: number | null) {
  return useQuery({
    queryKey: ["file-content", itemId],
    queryFn: () => api.getText(`/api/items/${itemId}/file`),
    enabled: itemId !== null,
    staleTime: 300_000,
  });
}

export function useUploadFinal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, content }: { id: number; content: string }) =>
      api.postText<{ ok: boolean; learnings: number; finalPath: string }>(
        `/api/agent-outputs/${id}/final`,
        content
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent-outputs"] });
    },
  });
}
