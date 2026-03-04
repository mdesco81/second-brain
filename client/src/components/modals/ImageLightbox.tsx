import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useUIStore } from "@/stores/ui-store";
import { X } from "lucide-react";

export function ImageLightbox() {
  const { lightboxSrc, setLightboxSrc } = useUIStore();

  return (
    <DialogPrimitive.Root open={!!lightboxSrc} onOpenChange={(open) => { if (!open) setLightboxSrc(null); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-md" onClick={() => setLightboxSrc(null)} />
        <DialogPrimitive.Content className="fixed inset-4 z-[100] flex items-center justify-center focus:outline-none">
          <DialogPrimitive.Close className="absolute top-4 right-4 p-2 rounded-full bg-bg-overlay/80 text-text-primary hover:bg-bg-overlay transition-colors z-10">
            <X className="w-5 h-5" />
          </DialogPrimitive.Close>
          {lightboxSrc && (
            <img src={lightboxSrc} alt="Imagem em tela cheia" className="max-w-full max-h-full object-contain rounded-lg" />
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
