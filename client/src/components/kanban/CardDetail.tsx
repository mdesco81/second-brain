import { useAttachments } from "@/hooks/use-attachments";
import { useExpandItem } from "@/hooks/use-actions";
import { useUIStore } from "@/stores/ui-store";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatDateBR, inputTypeLabel } from "@/lib/utils";
import { Paperclip, FileText, Image, Volume2, File, ExternalLink, Download, Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import type { DashboardItem, Attachment } from "@/types/api";

interface CardDetailProps {
  item: DashboardItem;
}

export function CardDetail({ item }: CardDetailProps) {
  const { data: attachments } = useAttachments(item.hasFile || (item.attachmentCount ?? 0) > 0 ? item.id : null);
  const expandItem = useExpandItem();
  const { openEditModal, setLightboxSrc } = useUIStore();
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    expandItem.mutate(item.id);
  }, [item.id]);

  return (
    <div className="mt-3 pt-3 border-t border-border-subtle space-y-3" onClick={(e) => e.stopPropagation()}>
      {/* Progressive Layer 2 */}
      {item.progressive?.layer2 && item.progressive.layer2.length > 0 && (
        <div className="space-y-1">
          {item.progressive.layer2.map((highlight, i) => (
            <p key={i} className="text-xs bg-accent-subtle text-accent px-2 py-1 rounded">
              {highlight}
            </p>
          ))}
        </div>
      )}

      {/* Summary */}
      {item.actionTitle && (
        <div>
          <span className="text-[0.7rem] text-text-tertiary uppercase tracking-wider">Interpretação</span>
          <p className="text-sm text-text-secondary mt-0.5">{item.summaryPtBr}</p>
        </div>
      )}

      {/* Key info */}
      {item.nextStep && (
        <div>
          <span className="text-[0.7rem] text-text-tertiary uppercase tracking-wider">Próximo passo</span>
          <p className="text-sm text-text-secondary mt-0.5">{item.nextStep}</p>
        </div>
      )}
      {item.followUpWith && (
        <div>
          <span className="text-[0.7rem] text-text-tertiary uppercase tracking-wider">Responsável</span>
          <p className="text-sm text-text-secondary mt-0.5">{item.followUpWith}</p>
        </div>
      )}

      {/* Full meta */}
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="muted">#{item.id}</Badge>
        <Badge variant={item.priority === "ALTA" ? "error" : item.priority === "MEDIA" ? "warning" : "success"}>
          {item.priority === "ALTA" ? "Alta" : item.priority === "MEDIA" ? "M\u00e9dia" : "Baixa"}
        </Badge>
        {item.categoryName && <Badge>{item.categoryName}</Badge>}
        <Badge variant="muted">{inputTypeLabel(item.inputType)}</Badge>
        {item.dueAt && <Badge variant="warning">{formatDateBR(item.dueAt)}</Badge>}
      </div>

      {/* Attachments */}
      {attachments && attachments.length > 0 && (
        <div className="space-y-2">
          <span className="text-[0.7rem] text-text-tertiary uppercase tracking-wider flex items-center gap-1">
            <Paperclip className="w-3 h-3" /> Anexos ({attachments.length})
          </span>
          {attachments.map((att) => (
            <AttachmentItem key={att.id} attachment={att} onImageClick={(url) => setLightboxSrc(url)} />
          ))}
        </div>
      )}

      {/* Raw text toggle */}
      {item.rawText && (
        <div>
          <button
            onClick={() => setShowRaw(!showRaw)}
            className="text-xs text-text-tertiary hover:text-accent transition-colors"
          >
            {showRaw ? "Ocultar original" : "Mensagem original"}
          </button>
          {showRaw && (
            <pre className="mt-1 text-xs text-text-secondary bg-bg-surface p-2 rounded-md overflow-x-auto whitespace-pre-wrap">
              {item.rawText}
            </pre>
          )}
        </div>
      )}

      {/* Action details */}
      {item.actionDetails && (
        <div>
          <span className="text-[0.7rem] text-text-tertiary uppercase tracking-wider">Detalhes</span>
          <p className="text-xs text-text-secondary mt-0.5">{item.actionDetails}</p>
        </div>
      )}

      {/* Processing error */}
      {item.processingError && (
        <p className="text-xs text-error bg-error-subtle p-2 rounded">{item.processingError}</p>
      )}

      {/* Created at + edit button */}
      <div className="flex items-center justify-between pt-2">
        <span className="text-[0.65rem] text-text-tertiary">
          Criado em {formatDateBR(item.createdAt)}
        </span>
        <Button size="sm" variant="ghost" onClick={() => openEditModal(item)}>
          <Pencil className="w-3 h-3" /> Editar
        </Button>
      </div>
    </div>
  );
}

function AttachmentItem({ attachment, onImageClick }: { attachment: Attachment; onImageClick: (url: string) => void }) {
  const isImage = attachment.inputType === "image";
  const isPdf = attachment.inputType === "pdf";
  const isAudio = attachment.inputType === "audio";

  const Icon = isImage ? Image : isPdf ? FileText : isAudio ? Volume2 : File;

  return (
    <div className="flex items-center gap-2 p-2 rounded-md bg-bg-surface border border-border-subtle">
      <Icon className="w-4 h-4 text-text-tertiary flex-shrink-0" />
      <span className="text-xs text-text-secondary flex-1 truncate">{attachment.fileName}</span>
      <div className="flex gap-1">
        {isImage && (
          <button onClick={() => onImageClick(attachment.url)} className="p-1 rounded hover:bg-bg-overlay text-text-tertiary hover:text-text-primary transition-colors">
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        )}
        {isAudio && (
          <audio controls className="h-7 max-w-[180px]">
            <source src={attachment.url} />
          </audio>
        )}
        <a href={attachment.url} download className="p-1 rounded hover:bg-bg-overlay text-text-tertiary hover:text-text-primary transition-colors">
          <Download className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
}
