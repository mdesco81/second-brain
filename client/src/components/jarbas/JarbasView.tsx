import { useAgentOutputs, useFileContent, useUploadFinal } from "@/hooks/use-jarbas";
import { useDeleteAction } from "@/hooks/use-actions";
import { useToast } from "@/components/ui/Toast";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { cn } from "@/lib/cn";
import { truncate, formatDateBR } from "@/lib/utils";
import { Download, Upload, Trash2, PenLine } from "lucide-react";
import { useState, useRef } from "react";
import type { JarbasOutput } from "@/types/api";

export function JarbasView() {
  const { data: outputs, isLoading } = useAgentOutputs();

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-64" />)}
      </div>
    );
  }

  if (!outputs || outputs.length === 0) {
    return (
      <div className="p-4 md:p-6">
        <EmptyState
          icon={<PenLine className="w-10 h-10" />}
          title="Nenhum trabalho do Jarbas ainda"
          description='Envie uma mensagem no Telegram com "Jarbas escreve um post sobre..." para começar.'
        />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {outputs.map((output) => (
        <JarbasCard key={output.id} output={output} />
      ))}
    </div>
  );
}

function JarbasCard({ output }: { output: JarbasOutput }) {
  const { data: preview } = useFileContent(output.id);
  const uploadFinal = useUploadFinal();
  const deleteAction = useDeleteAction();
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const typeLabel = output.contentType === "article" ? "Artigo" : "Post";
  const topic = output.topic || output.summaryPtBr || "Sem título";

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const content = await file.text();
      await uploadFinal.mutateAsync({ id: output.id, content });
      showToast("Versão final enviada!", "success");
    } catch { showToast("Erro ao enviar versão final", "error"); }
  }

  async function handleDelete() {
    try {
      await deleteAction.mutateAsync(output.id);
      showToast("Output deletado", "success");
    } catch { showToast("Erro ao deletar", "error"); }
  }

  return (
    <article className="rounded-lg border border-border-default bg-bg-elevated p-4 flex flex-col">
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="text-sm font-semibold text-text-primary leading-snug flex-1">{truncate(topic, 80)}</h3>
        <Badge variant={output.hasFinalVersion ? "success" : "muted"}>
          {output.hasFinalVersion ? "Finalizado" : "Rascunho"}
        </Badge>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        <Badge variant="accent">{typeLabel}</Badge>
        <Badge variant="muted">#{output.id}</Badge>
        <Badge variant="muted">{formatDateBR(output.createdAt)}</Badge>
      </div>

      {output.hashtags && output.hashtags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {output.hashtags.map((h, i) => (
            <span key={i} className="text-[0.65rem] text-accent bg-accent-subtle px-1.5 py-0.5 rounded">{h}</span>
          ))}
        </div>
      )}

      {preview && (
        <p className="text-xs text-text-secondary mb-3 flex-1 line-clamp-4">{truncate(preview, 300)}</p>
      )}

      {output.hooks && output.hooks.length > 0 && (
        <div className="mb-3 space-y-1">
          <span className="text-[0.65rem] text-text-tertiary font-medium">Ganchos:</span>
          {output.hooks.map((h, i) => (
            <div key={i} className={cn("text-xs px-2 py-1 rounded border", h.selected ? "border-accent bg-accent-subtle text-accent" : "border-border-subtle text-text-secondary")}>
              <span className="font-medium text-text-tertiary">{h.type}</span> {h.text}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 mt-auto pt-3 border-t border-border-subtle">
        <a href={`/api/items/${output.id}/file`} download className="flex-1">
          <Button variant="secondary" size="sm" className="w-full">
            <Download className="w-3.5 h-3.5" /> Download MD
          </Button>
        </a>
        {!output.hasFinalVersion ? (
          <>
            <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
              <Upload className="w-3.5 h-3.5" />
            </Button>
            <input ref={fileInputRef} type="file" accept=".md,.txt" onChange={handleUpload} className="hidden" />
          </>
        ) : (
          <Badge variant="success" className="text-[0.65rem]">Final enviada</Badge>
        )}
        <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(true)}>
          <Trash2 className="w-3.5 h-3.5 text-text-tertiary" />
        </Button>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Deletar output"
        message={`Tem certeza que deseja deletar "${truncate(topic, 40)}"? Esta ação não pode ser desfeita.`}
        confirmText="Deletar"
        variant="danger"
        onConfirm={handleDelete}
      />
    </article>
  );
}
