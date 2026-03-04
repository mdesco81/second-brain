import { create } from "zustand";
import type { ActionPriority } from "@/types/api";

interface FilterState {
  priority: ActionPriority | "all";
  category: string;
  searchQuery: string;

  setPriority: (p: ActionPriority | "all") => void;
  setCategory: (c: string) => void;
  setSearchQuery: (q: string) => void;
  clearAll: () => void;
}

export const useFilterStore = create<FilterState>((set) => ({
  priority: "all",
  category: "all",
  searchQuery: "",

  setPriority: (priority) => set({ priority }),
  setCategory: (category) => set({ category }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  clearAll: () => set({ priority: "all", category: "all", searchQuery: "" }),
}));
