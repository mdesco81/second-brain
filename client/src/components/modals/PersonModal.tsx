import { useState, useEffect } from "react";
import { Dialog, DialogHeader, DialogBody, DialogFooter } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select, SelectItem } from "@/components/ui/Select";
import { useUIStore } from "@/stores/ui-store";
import { useCreatePerson, useUpdatePerson } from "@/hooks/use-people";
import { useToast } from "@/components/ui/Toast";

export function PersonModal() {
  const { personModalOpen, personModalData, closePersonModal } = useUIStore();
  const createPerson = useCreatePerson();
  const updatePerson = useUpdatePerson();
  const { showToast } = useToast();
  const isEditing = !!personModalData;

  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [relationship, setRelationship] = useState("direct_report");
  const [email, setEmail] = useState("");
  const [cadence, setCadence] = useState("weekly");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (personModalData) {
      setName(personModalData.name || "");
      setRole(personModalData.role || "");
      setRelationship(personModalData.relationship || "direct_report");
      setEmail(personModalData.email || "");
      setCadence(personModalData.oneOnOneCadence || "weekly");
      setNotes(personModalData.notes || "");
    } else {
      setName(""); setRole(""); setRelationship("direct_report");
      setEmail(""); setCadence("weekly"); setNotes("");
    }
  }, [personModalData]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { showToast("Nome é obrigatório", "error"); return; }
    const fields = { name: name.trim(), role: role.trim(), relationship, email: email.trim(), oneOnOneCadence: cadence, notes: notes.trim() };
    try {
      if (isEditing) {
        await updatePerson.mutateAsync({ id: personModalData!.id, fields });
        showToast("Pessoa atualizada!", "success");
      } else {
        await createPerson.mutateAsync(fields);
        showToast("Pessoa adicionada!", "success");
      }
      closePersonModal();
    } catch { showToast("Erro ao salvar pessoa", "error"); }
  }

  return (
    <Dialog open={personModalOpen} onOpenChange={(open) => { if (!open) closePersonModal(); }}>
      <form onSubmit={handleSubmit}>
        <DialogHeader>{isEditing ? "Editar Pessoa" : "Nova Pessoa"}</DialogHeader>
        <DialogBody>
          <div>
            <label className="text-[0.7rem] font-medium text-text-tertiary uppercase tracking-wider">Nome *</label>
            <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} required placeholder="Nome completo" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[0.7rem] font-medium text-text-tertiary uppercase tracking-wider">Papel / Cargo</label>
              <Input className="mt-1" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Ex: Gerente de Vendas" />
            </div>
            <div>
              <label className="text-[0.7rem] font-medium text-text-tertiary uppercase tracking-wider">Relação</label>
              <Select value={relationship} onValueChange={setRelationship} className="mt-1">
                <SelectItem value="direct_report">Subordinado direto</SelectItem>
                <SelectItem value="peer">Par</SelectItem>
                <SelectItem value="manager">Gestor</SelectItem>
                <SelectItem value="client">Cliente</SelectItem>
                <SelectItem value="vendor">Fornecedor</SelectItem>
                <SelectItem value="other">Outro</SelectItem>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[0.7rem] font-medium text-text-tertiary uppercase tracking-wider">Email</label>
              <Input className="mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@exemplo.com" />
            </div>
            <div>
              <label className="text-[0.7rem] font-medium text-text-tertiary uppercase tracking-wider">Cadência 1:1</label>
              <Select value={cadence} onValueChange={setCadence} className="mt-1">
                <SelectItem value="weekly">Semanal</SelectItem>
                <SelectItem value="biweekly">Quinzenal</SelectItem>
                <SelectItem value="monthly">Mensal</SelectItem>
                <SelectItem value="none">Nenhuma</SelectItem>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-[0.7rem] font-medium text-text-tertiary uppercase tracking-wider">Notas</label>
            <Textarea className="mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Observações sobre esta pessoa" />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={closePersonModal}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={createPerson.isPending || updatePerson.isPending}>
            {(createPerson.isPending || updatePerson.isPending) ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
