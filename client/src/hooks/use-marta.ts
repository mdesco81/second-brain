import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type {
  CosDataResponse,
  RemindersResponse,
  HealthResponse,
  CommitmentsResponse,
  CosOutput,
} from "@/types/api";
import { REFRESH_INTERVAL } from "@/lib/constants";

export function useCosData() {
  return useQuery({
    queryKey: ["cos-data"],
    queryFn: () => api.get<CosDataResponse>("/api/cos"),
  });
}

export function useReminders() {
  return useQuery({
    queryKey: ["reminders"],
    queryFn: async () => {
      const data = await api.get<RemindersResponse>("/api/reminders");
      return data.reminders;
    },
    refetchInterval: REFRESH_INTERVAL,
  });
}

export function useRelationshipHealth() {
  return useQuery({
    queryKey: ["relationship-health"],
    queryFn: async () => {
      const data = await api.get<HealthResponse>("/api/relationship-health");
      return data.health;
    },
  });
}

export function useCommitments() {
  return useQuery({
    queryKey: ["commitments"],
    queryFn: async () => {
      const data = await api.get<CommitmentsResponse>("/api/commitments");
      return data.commitments;
    },
  });
}

export function useCosOutput(id: number | null) {
  return useQuery({
    queryKey: ["cos-output", id],
    queryFn: () => api.get<CosOutput>(`/api/cos/output/${id}`),
    enabled: id !== null,
  });
}

export function useDeleteCosOutput() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      api.delete<{ ok: boolean }>(`/api/cos/output/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cos-data"] });
    },
  });
}

export function useCancelReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      api.post<{ ok: boolean }>(`/api/reminders/${id}/cancel`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reminders"] });
    },
  });
}

export function useUpdateCommitmentStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      api.patch<{ ok: boolean }>(`/api/commitments/${id}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["commitments"] });
    },
  });
}

export function useUploadNotes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, personId }: { file: File; personId: string }) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("personId", personId);
      return api.postFormData<{ ok: boolean; result: Record<string, unknown> }>(
        "/api/cos/upload-notes",
        formData
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cos-data"] });
      qc.invalidateQueries({ queryKey: ["reminders"] });
      qc.invalidateQueries({ queryKey: ["commitments"] });
      qc.invalidateQueries({ queryKey: ["relationship-health"] });
    },
  });
}
