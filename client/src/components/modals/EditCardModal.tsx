import { useState, useEffect, useRef } from "react";
import { Dialog, DialogHeader, DialogBody, DialogFooter } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select, SelectItem } from "@/components/ui/Select";
import { useUIStore } from "@/stores/ui-store";
import { usePatchAction } from "@/hooks/use-actions";
import { useCategories } from "@/hooks/use-categories";
import { useVoiceDictation } from "@/hooks/use-voice-dictation";
import { useToast } from "@/components/ui/Toast";
import { MAX_ACTION_TITLE_LENGTH } from "@/lib/constants";
import { Mic, MicOff } from "lucide-react";

export function EditCardModal() {
  const { editModalOpen, editingItem, closeEditModal } = useUIStore();
  const patchAction = usePatchAction();
  const { data: categories } = useCategories();
  const { showToast } = useToast();
  const { isRecording, toggle, isSupported } = useVoiceDictation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [summary, setSummary] = useState("");
  const [actionTitle, setActionTitle] = useState("");
  const [priority, setPriority] = useState("MEDIA");
  const [dueAt, setDueAt] = useState("");
  const [category, setCategory] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [owner, setOwner] = useState("");

  useEffect(() => {
    if (editingItem) {
      setSummary(editingItem.summaryPtBr || "");
      setActionTitle(editingItem.actionTitle || "");
      setPriority(editingItem.priority || "MEDIA");
      setDueAt(editingItem.dueAt || "");
      setCategory(editingItem.categoryName || "");
      setNextStep(editingItem.nextStep || "");
      setOwner(editingItem.followUpWith || "");
    }
  }, [editingItem]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingItem) return;
    try {
      await patchAction.mutateAsync({
        id: editingItem.id,
        fields: {
          summaryPtBr: summary.trim(),
          actionTitle: actionTitle.trim().slice(0, MAX_ACTION_TITLE_LENGTH) || null,
          priority: priority as "ALTA" | "MEDIA" | "BAIXA",
          dueAt: dueAt || null,
          categoryName: category || undefined,
          nextStep: nextStep.trim() || null,
          followUpWith: owner.trim() || null,
        },
      });
      showToast("Card atualizado!", "success");
      closeEditModal();
    } catch { showToast("Erro ao atualizar card", "error"); }
  }

  return (
    <Dialog open={editModalOpen} onOpenChange={(open) => { if (!open) closeEditModal(); }}>
      <form onSubmit={handleSubmit}>
        <DialogHeader>Editar Card #{editingItem?.id}</DialogHeader>
        <DialogBody>
          <div>
            <label className="text-[0.7rem] font-medium text-text-tertiary uppercase tracking-wider">Interpretação / Resumo</label>
            <div className="relative mt-1">
              <Textarea ref={textareaRef} value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} />
              {isSupported && (
                <button type="button" onClick={() => toggle(textareaRef)} className={`absolute right-2 top-2 p-1.5 rounded-md transition-colors ${isRecording ? "bg-error text-white" : "text-text-tertiary hover:text-accent hover:bg-bg-overlay"}`}>
                  {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>
              )}
            </div>
          </div>
          <div>
            <label className="text-[0.7rem] font-medium text-text-tertiary uppercase tracking-wider">Título da ação</label>
            <Input className="mt-1" value={actionTitle} onChange={(e) => setActionTitle(e.target.value)} maxLength={MAX_ACTION_TITLE_LENGTH} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[0.7rem] font-medium text-text-tertiary uppercase tracking-wider">Prioridade</label>
              <Select value={priority} onValueChange={setPriority} className="mt-1">
                <SelectItem value="ALTA">Alta</SelectItem>
                <SelectItem value="MEDIA">Média</SelectItem>
                <SelectItem value="BAIXA">Baixa</SelectItem>
              </Select>
            </div>
            <div>
              <label className="text-[0.7rem] font-medium text-text-tertiary uppercase tracking-wider">Prazo</label>
              <Input className="mt-1" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
            </div>
            <div>
              <label className="text-[0.7rem] font-medium text-text-tertiary uppercase tracking-wider">Categoria</label>
              <Select value={category} onValueChange={setCategory} className="mt-1">
                <SelectItem value="">Nenhuma</SelectItem>
                {categories?.map((c) => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
              </Select>
            </div>
          </div>
          <div>
            <label className="text-[0.7rem] font-medium text-text-tertiary uppercase tracking-wider">Próximo passo</label>
            <Input className="mt-1" value={nextStep} onChange={(e) => setNextStep(e.target.value)} />
          </div>
          <div>
            <label className="text-[0.7rem] font-medium text-text-tertiary uppercase tracking-wider">Responsável</label>
            <Input className="mt-1" value={owner} onChange={(e) => setOwner(e.target.value)} />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={closeEditModal}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={patchAction.isPending}>
            {patchAction.isPending ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
