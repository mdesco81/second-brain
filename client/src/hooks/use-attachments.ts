import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { Attachment } from "@/types/api";

export function useAttachments(itemId: number | null) {
  return useQuery({
    queryKey: ["attachments", itemId],
    queryFn: async () => {
      const data = await api.get<{ ok: boolean; attachments: Attachment[] }>(
        `/api/items/${itemId}/files`
      );
      return data.attachments;
    },
    enabled: itemId !== null,
    staleTime: 60_000,
  });
}
