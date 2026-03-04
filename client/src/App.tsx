import { ToastProvider } from "@/components/ui/Toast";
import { AppShell } from "@/components/layout/AppShell";
import { CreateCardModal } from "@/components/modals/CreateCardModal";
import { EditCardModal } from "@/components/modals/EditCardModal";
import { PersonModal } from "@/components/modals/PersonModal";
import { ImageLightbox } from "@/components/modals/ImageLightbox";

export function App() {
  return (
    <ToastProvider>
      <AppShell />
      <CreateCardModal />
      <EditCardModal />
      <PersonModal />
      <ImageLightbox />
    </ToastProvider>
  );
}
