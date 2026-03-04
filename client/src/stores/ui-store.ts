import { create } from "zustand";
import type { DashboardItem, Person } from "@/types/api";

export type ActiveView = "dashboard" | "kanban" | "jarbas" | "marta";

interface UIState {
  // Navigation
  activeView: ActiveView;
  sidebarCollapsed: boolean;
  sidebarOpen: boolean; // mobile overlay

  // Card interaction
  expandedCardId: number | null;
  editingItem: DashboardItem | null;

  // Modals
  createModalOpen: boolean;
  editModalOpen: boolean;
  personModalOpen: boolean;
  personModalData: Person | null;
  lightboxSrc: string | null;

  // Mobile
  bottomSheetCardId: number | null;

  // Actions
  setActiveView: (view: ActiveView) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setExpandedCard: (id: number | null) => void;
  openEditModal: (item: DashboardItem) => void;
  closeEditModal: () => void;
  setCreateModalOpen: (open: boolean) => void;
  openPersonModal: (person: Person | null) => void;
  closePersonModal: () => void;
  setLightboxSrc: (src: string | null) => void;
  setBottomSheetCard: (id: number | null) => void;
  navigateToCard: (id: number) => void;
}

export const useUIStore = create<UIState>((set) => ({
  activeView: "dashboard",
  sidebarCollapsed: false,
  sidebarOpen: false,
  expandedCardId: null,
  editingItem: null,
  createModalOpen: false,
  editModalOpen: false,
  personModalOpen: false,
  personModalData: null,
  lightboxSrc: null,
  bottomSheetCardId: null,

  setActiveView: (view) => set({ activeView: view }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setExpandedCard: (id) => set({ expandedCardId: id }),
  openEditModal: (item) => set({ editingItem: item, editModalOpen: true }),
  closeEditModal: () => set({ editingItem: null, editModalOpen: false }),
  setCreateModalOpen: (open) => set({ createModalOpen: open }),
  openPersonModal: (person) => set({ personModalData: person, personModalOpen: true }),
  closePersonModal: () => set({ personModalData: null, personModalOpen: false }),
  setLightboxSrc: (src) => set({ lightboxSrc: src }),
  setBottomSheetCard: (id) => set({ bottomSheetCardId: id }),
  navigateToCard: (id) => set({ activeView: "kanban", expandedCardId: id }),
}));
