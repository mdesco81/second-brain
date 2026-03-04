import { useCosData, useReminders, useRelationshipHealth, useCommitments, useCancelReminder, useUpdateCommitmentStatus, useUploadNotes } from "@/hooks/use-marta";
import { useUpdateStatus } from "@/hooks/use-actions";
import { useUIStore } from "@/stores/ui-store";
import { useToast } from "@/components/ui/Toast";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { FileDropzone } from "@/components/ui/FileDropzone";
import { Select, SelectItem } from "@/components/ui/Select";
import { cn } from "@/lib/cn";
import { formatDateTimeBR, formatShortDateBR, truncate } from "@/lib/utils";
import { Users, Heart, Bell, Handshake, UserPlus, FileText, Pencil, X, Check, RotateCcw, Copy, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { MAX_FILE_SIZE } from "@/lib/constants";
import type { PersonWithItems, Commitment, Reminder, HealthScore, CosOutput } from "@/types/api";

export function MartaView() {
  const { data: cosData, isLoading: cosLoading } = useCosData();
  const { data: reminders } = useReminders();
  const { data: health } = useRelationshipHealth();
  const { data: commitments } = useCommitments();

  if (cosLoading) {
    return (
      <div className="p-4 md:p-6 space-y-6">
        <Skeleton className="h-40" />
        <Skeleton className="h-32" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  const people = cosData?.people ?? [];
  const outputs = cosData?.outputs ?? [];
  const hasData = people.length > 0 || outputs.length > 0;

  if (!hasData) {
    return (
      <div className="p-4 md:p-6">
        <EmptyState icon={<Users className="w-10 h-10" />} title="Nenhum dado da Marta ainda" description='Envie no Telegram: "Marta, adiciona o [nome], [papel]" para começar.' />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-8 max-w-5xl">
      <UploadNotesSection people={people} />
      {health && health.length > 0 && <HealthSection health={health} />}
      {reminders && reminders.length > 0 && <RemindersSection reminders={reminders} />}
      {commitments && commitments.length > 0 && <CommitmentsSection commitments={commitments} />}
      <PeopleSection people={people} />
      {outputs.length > 0 && <OutputsSection outputs={outputs} />}
    </div>
  );
}

function UploadNotesSection({ people }: { people: PersonWithItems[] }) {
  const uploadNotes = useUploadNotes();
  const { showToast } = useToast();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [personId, setPersonId] = useState("");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  async function handleUpload() {
    if (!selectedFile || !personId) return;
    if (selectedFile.size > MAX_FILE_SIZE) { showToast("Arquivo muito grande (max 5MB)", "error"); return; }
    try {
      const data = await uploadNotes.mutateAsync({ file: selectedFile, personId });
      setResult(data.result);
      showToast("Notas processadas!", "success");
      setSelectedFile(null);
    } catch { showToast("Erro ao processar notas", "error"); }
  }

  return (
    <section>
      <h2 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
        <FileText className="w-4 h-4 text-text-tertiary" /> Upload de Notas
      </h2>
      <div className="space-y-3">
        <FileDropzone accept=".pdf,.md,.txt,.text" maxSize={MAX_FILE_SIZE} onFileSelect={setSelectedFile} hint="PDF, Markdown ou Texto (max 5MB)" />
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="text-[0.7rem] font-medium text-text-tertiary uppercase tracking-wider">Pessoa</label>
            <Select value={personId} onValueChange={setPersonId} placeholder="Selecione..." className="mt-1">
              {people.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}{p.role ? ` (${p.role})` : ""}</SelectItem>)}
            </Select>
          </div>
          <Button variant="primary" onClick={handleUpload} disabled={!selectedFile || !personId || uploadNotes.isPending}>
            {uploadNotes.isPending ? "Processando..." : "Processar Notas"}
          </Button>
        </div>
        {result && (
          <div className="rounded-lg border border-success/30 bg-success-subtle p-4 text-sm text-text-primary">
            <p className="font-medium mb-1">Notas processadas!</p>
            <p className="text-text-secondary text-xs">{JSON.stringify(result, null, 2).slice(0, 300)}</p>
          </div>
        )}
      </div>
    </section>
  );
}

function HealthSection({ health }: { health: HealthScore[] }) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
        <Heart className="w-4 h-4 text-text-tertiary" /> Saúde dos Relacionamentos
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {health.map((h) => {
          const levelColor = h.level === "hot" ? "border-success" : h.level === "warm" ? "border-warning" : "border-error";
          return (
            <div key={h.personId} className={cn("rounded-lg border-l-[3px] border border-border-default bg-bg-elevated p-3", levelColor)}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-text-primary">{h.personName}</span>
                <Badge variant={h.level === "hot" ? "success" : h.level === "warm" ? "warning" : "error"}>{h.score}</Badge>
              </div>
              <div className="space-y-1.5">
                <FactorBar label="1:1" value={h.factors.oneOnOneAdherence} />
                <FactorBar label="Itens" value={h.factors.openItemsHealth} />
                <FactorBar label="Compromissos" value={h.factors.commitmentFulfillment} />
                <FactorBar label="Contato" value={h.factors.contactRecency} />
              </div>
              {h.alerts.length > 0 && (
                <div className="mt-2 space-y-0.5">
                  {h.alerts.map((a, i) => <p key={i} className="text-[0.65rem] text-error">⚠ {a}</p>)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function FactorBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round((value / 25) * 100);
  return (
    <div className="flex items-center gap-2 text-[0.65rem]">
      <span className="w-20 text-text-tertiary truncate">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-bg-overlay">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-text-tertiary w-8 text-right">{value}/25</span>
    </div>
  );
}

function RemindersSection({ reminders }: { reminders: Reminder[] }) {
  const cancelReminder = useCancelReminder();
  const { showToast } = useToast();

  return (
    <section>
      <h2 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
        <Bell className="w-4 h-4 text-text-tertiary" /> Lembretes Pendentes
      </h2>
      <div className="space-y-2">
        {reminders.map((r) => {
          const isPast = new Date(r.triggerAt) < new Date();
          return (
            <div key={r.id} className={cn("rounded-lg border border-border-default bg-bg-elevated p-3 flex items-start gap-3", isPast && "border-error/30")}>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text-primary">{r.text}</p>
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  <span className={cn("text-xs", isPast ? "text-error font-medium" : "text-text-tertiary")}>{formatDateTimeBR(r.triggerAt)}</span>
                  {r.recurrence && <Badge variant="muted">{r.recurrence}</Badge>}
                  {r.personName && <Badge variant="accent">{r.personName}</Badge>}
                </div>
              </div>
              <button
                onClick={async () => {
                  try { await cancelReminder.mutateAsync(r.id); showToast("Lembrete cancelado", "success"); }
                  catch { showToast("Erro ao cancelar", "error"); }
                }}
                className="p-1 text-text-tertiary hover:text-error transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CommitmentsSection({ commitments }: { commitments: Commitment[] }) {
  const updateStatus = useUpdateCommitmentStatus();
  const { showToast } = useToast();
  const mine = commitments.filter((c) => c.direction === "mine");
  const theirs = commitments.filter((c) => c.direction === "theirs");

  function CommitmentCard({ c }: { c: Commitment }) {
    const isOverdue = c.deadline && new Date(c.deadline) < new Date();
    return (
      <div className="rounded-lg border border-border-default bg-bg-elevated p-3">
        <p className="text-sm text-text-primary">{c.summary}</p>
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-1.5">
            {c.personName && <Badge variant="accent">{c.personName}</Badge>}
            {c.deadline && <span className={cn("text-xs", isOverdue ? "text-error font-medium" : "text-text-tertiary")}>{formatShortDateBR(c.deadline)}{isOverdue ? " (atrasado)" : ""}</span>}
          </div>
          <div className="flex gap-1">
            <button onClick={async () => { try { await updateStatus.mutateAsync({ id: c.id, status: "fulfilled" }); showToast("Cumprido!", "success"); } catch { showToast("Erro", "error"); } }} className="p-1 text-text-tertiary hover:text-success transition-colors"><Check className="w-4 h-4" /></button>
            <button onClick={async () => { try { await updateStatus.mutateAsync({ id: c.id, status: "cancelled" }); showToast("Cancelado", "success"); } catch { showToast("Erro", "error"); } }} className="p-1 text-text-tertiary hover:text-error transition-colors"><X className="w-4 h-4" /></button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section>
      <h2 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
        <Handshake className="w-4 h-4 text-text-tertiary" /> Compromissos Abertos
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <h3 className="text-xs font-medium text-text-tertiary mb-2">Meus compromissos ({mine.length})</h3>
          <div className="space-y-2">{mine.length ? mine.map((c) => <CommitmentCard key={c.id} c={c} />) : <p className="text-xs text-text-tertiary">Nenhum compromisso</p>}</div>
        </div>
        <div>
          <h3 className="text-xs font-medium text-text-tertiary mb-2">Compromissos deles ({theirs.length})</h3>
          <div className="space-y-2">{theirs.length ? theirs.map((c) => <CommitmentCard key={c.id} c={c} />) : <p className="text-xs text-text-tertiary">Nenhum compromisso</p>}</div>
        </div>
      </div>
    </section>
  );
}

function PeopleSection({ people }: { people: PersonWithItems[] }) {
  const { openPersonModal } = useUIStore();
  const updateStatus = useUpdateStatus();
  const { showToast } = useToast();

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <Users className="w-4 h-4 text-text-tertiary" /> Pessoas
        </h2>
        <Button size="sm" variant="primary" onClick={() => openPersonModal(null)}>
          <UserPlus className="w-3.5 h-3.5" /> Adicionar
        </Button>
      </div>
      <div className="space-y-4">
        {people.map((person) => {
          const alertClass = person.stats.totalOverdue > 0;
          const lastOO = person.lastOneOnOne ? formatShortDateBR(person.lastOneOnOne) : "nunca";
          return (
            <div key={person.id} className="rounded-lg border border-border-default bg-bg-surface overflow-hidden">
              <div className={cn("flex items-center justify-between px-4 py-2.5", alertClass ? "bg-error-subtle" : "bg-bg-elevated")}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary">{person.name}{person.role ? ` (${person.role})` : ""}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-text-tertiary">
                  <span>1:1: {lastOO}</span>
                  {person.stats.totalOverdue > 0 ? <Badge variant="error">{person.stats.totalOverdue} atrasado{person.stats.totalOverdue > 1 ? "s" : ""}</Badge> : <Badge variant="success">Em dia</Badge>}
                  <button onClick={() => openPersonModal(person)} className="p-1 hover:text-accent transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-border-subtle">
                <MiniColumn title={`Pendente (${person.items.open.length})`} items={person.items.open} onStatusChange={async (id, status) => { try { await updateStatus.mutateAsync({ id, status }); showToast("Atualizado!", "success"); } catch { showToast("Erro", "error"); } }} />
                <MiniColumn title={`Concluído (${person.stats.totalDone})`} items={person.items.done.slice(0, 5)} done />
                <MiniColumn title="Eliminado" items={person.items.eliminated.slice(0, 3)} eliminated />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MiniColumn({ title, items, done, eliminated, onStatusChange }: { title: string; items: any[]; done?: boolean; eliminated?: boolean; onStatusChange?: (id: number, status: "open" | "done") => void }) {
  return (
    <div className="bg-bg-elevated p-2">
      <h4 className="text-[0.65rem] font-medium text-text-tertiary uppercase tracking-wider mb-1.5">{title}</h4>
      <div className="space-y-1">
        {items.length === 0 ? (
          <p className="text-[0.65rem] text-text-tertiary italic">Nenhum item</p>
        ) : (
          items.map((item: any) => (
            <div key={item.id} className={cn("text-xs p-1.5 rounded border border-border-subtle flex items-center gap-1", done && "opacity-60 line-through", eliminated && "opacity-40")}>
              <span className="flex-1 truncate">{truncate(item.actionTitle || item.summaryPtBr, 50)}</span>
              {onStatusChange && !done && !eliminated && (
                <button onClick={() => onStatusChange(item.id, "done")} className="p-0.5 text-text-tertiary hover:text-success"><Check className="w-3 h-3" /></button>
              )}
              {done && onStatusChange && (
                <button onClick={() => onStatusChange(item.id, "open")} className="p-0.5 text-text-tertiary hover:text-accent"><RotateCcw className="w-3 h-3" /></button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function OutputsSection({ outputs }: { outputs: CosOutput[] }) {
  const { showToast } = useToast();
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const icons: Record<string, React.ReactNode> = {
    briefing: <FileText className="w-4 h-4" />,
    email_draft: <FileText className="w-4 h-4" />,
    status_report: <FileText className="w-4 h-4" />,
    reflection: <FileText className="w-4 h-4" />,
    one_on_one_notes: <FileText className="w-4 h-4" />,
  };

  return (
    <section>
      <h2 className="text-sm font-semibold text-text-primary mb-3">Outputs da Marta</h2>
      <div className="space-y-2">
        {outputs.map((output) => (
          <div key={output.id} className="rounded-lg border border-border-default bg-bg-elevated p-3">
            <div className="flex items-center gap-2 mb-1">
              {icons[output.outputType] || <FileText className="w-4 h-4" />}
              <span className="text-sm font-medium text-text-primary flex-1">{output.title}</span>
              <span className="text-[0.65rem] text-text-tertiary">{formatDateTimeBR(output.createdAt)}</span>
            </div>
            <p className="text-xs text-text-secondary mb-2">{truncate(output.content, 120)}</p>
            <div className="flex items-center gap-2">
              <button onClick={async () => { try { await navigator.clipboard.writeText(output.content); showToast("Copiado!", "success"); } catch { showToast("Erro ao copiar", "error"); } }} className="text-xs text-text-tertiary hover:text-accent flex items-center gap-1"><Copy className="w-3 h-3" /> Copiar</button>
              <button onClick={() => setExpandedId(expandedId === output.id ? null : output.id)} className="text-xs text-text-tertiary hover:text-accent flex items-center gap-1">{expandedId === output.id ? <><EyeOff className="w-3 h-3" /> Recolher</> : <><Eye className="w-3 h-3" /> Ver completo</>}</button>
            </div>
            {expandedId === output.id && (
              <pre className="mt-2 text-xs text-text-secondary bg-bg-surface p-3 rounded-md overflow-x-auto whitespace-pre-wrap">{output.content}</pre>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
