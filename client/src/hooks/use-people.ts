import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type {
  PeopleResponse,
  CreatePersonPayload,
  UpdatePersonPayload,
} from "@/types/api";

export function usePeople() {
  return useQuery({
    queryKey: ["people"],
    queryFn: async () => {
      const data = await api.get<PeopleResponse>("/api/people");
      return data.people;
    },
  });
}

export function useCreatePerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreatePersonPayload) =>
      api.post<{ ok: boolean; id: number }>("/api/people", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["people"] });
      qc.invalidateQueries({ queryKey: ["cos-data"] });
    },
  });
}

export function useUpdatePerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, fields }: { id: number; fields: UpdatePersonPayload }) =>
      api.patch<{ ok: boolean; id: number }>(`/api/people/${id}`, fields),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["people"] });
      qc.invalidateQueries({ queryKey: ["cos-data"] });
    },
  });
}

export function useDeactivatePerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      api.delete<{ ok: boolean; id: number }>(`/api/people/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["people"] });
      qc.invalidateQueries({ queryKey: ["cos-data"] });
    },
  });
}
