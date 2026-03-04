import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type {
  CreateActionPayload,
  UpdateActionPayload,
  ActionStatus,
} from "@/types/api";

export function useCreateAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateActionPayload) =>
      api.post<{ ok: boolean; id: number }>("/api/actions", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["inbox-queue"] });
    },
  });
}

export function usePatchAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, fields }: { id: number; fields: UpdateActionPayload }) =>
      api.patch<{ ok: boolean; id: number }>(`/api/actions/${id}`, fields),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useUpdateStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: ActionStatus }) =>
      api.patch<{ ok: boolean; id: number; status: ActionStatus }>(
        `/api/actions/${id}/status`,
        { status }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["inbox-queue"] });
      qc.invalidateQueries({ queryKey: ["cos-data"] });
    },
  });
}

export function useDeleteAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      api.delete<{ ok: boolean; id: number }>(`/api/actions/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["agent-outputs"] });
    },
  });
}

export function useExpandItem() {
  return useMutation({
    mutationFn: (id: number) =>
      api.post<{ ok: boolean; expandCount: number }>(`/api/items/${id}/expand`),
  });
}
