import { marked } from "marked";
import { useMemo } from "react";
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from "@/components/ui/BottomSheet";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Download, X } from "lucide-react";
import { cn } from "@/lib/cn";

interface ArticlePreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  markdown: string;
  contentType: "article" | "post";
  hashtags?: string[];
  itemId: number;
}

export function ArticlePreview({
  open,
  onOpenChange,
  title,
  markdown,
  contentType,
  hashtags,
  itemId,
}: ArticlePreviewProps) {
  const html = useMemo(() => {
    if (!markdown) return "";
    // Strip trailing hashtag line if present (we show them as badges)
    const cleaned = markdown.replace(/\n+(?:#[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9]+\s*)+\s*$/, "");
    return marked.parse(cleaned, { async: false }) as string;
  }, [markdown]);

  function handleDownloadPdf() {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const typeLabel = contentType === "article" ? "Artigo" : "Post";
    const hashtagsHtml = hashtags?.length
      ? `<div style="margin-top:24px;display:flex;flex-wrap:wrap;gap:6px">${hashtags.map((h) => `<span style="background:#e0e7ff;color:#3730a3;padding:2px 8px;border-radius:12px;font-size:12px">${h}</span>`).join("")}</div>`
      : "";

    printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${typeLabel}: ${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: Georgia, 'Times New Roman', serif;
      max-width: 700px;
      margin: 0 auto;
      padding: 40px 24px;
      color: #1a1a1a;
      line-height: 1.7;
      font-size: 15px;
    }
    h1 { font-size: 24px; margin-bottom: 8px; line-height: 1.3; }
    h2 { font-size: 19px; margin: 28px 0 12px; }
    h3 { font-size: 16px; margin: 24px 0 8px; }
    p { margin-bottom: 14px; }
    ul, ol { margin-bottom: 14px; padding-left: 24px; }
    li { margin-bottom: 4px; }
    blockquote {
      border-left: 3px solid #6366f1;
      padding-left: 16px;
      margin: 16px 0;
      color: #4b5563;
      font-style: italic;
    }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }
    strong { font-weight: 700; }
    a { color: #4f46e5; text-decoration: underline; }
    .meta { color: #6b7280; font-size: 13px; margin-bottom: 24px; }
    @media print {
      body { padding: 0; }
    }
  </style>
</head>
<body>
  <div class="meta">${typeLabel}</div>
  ${html}
  ${hashtagsHtml}
  <script>
    window.onafterprint = function() { window.close(); };
    setTimeout(function() { window.print(); }, 250);
  </script>
</body>
</html>`);
    printWindow.document.close();
  }

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} className="max-h-[95vh]">
      <BottomSheetHeader className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-text-primary truncate">{title}</h2>
          <div className="flex gap-1.5 mt-1">
            <Badge variant="accent">{contentType === "article" ? "Artigo" : "Post"}</Badge>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button variant="secondary" size="sm" onClick={handleDownloadPdf}>
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline ml-1">PDF</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </BottomSheetHeader>

      <BottomSheetBody className="pb-8">
        {hashtags && hashtags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-4">
            {hashtags.map((h, i) => (
              <span
                key={i}
                className="text-[0.65rem] text-accent bg-accent-subtle px-1.5 py-0.5 rounded"
              >
                {h}
              </span>
            ))}
          </div>
        )}

        <div
          className={cn(
            "prose-article",
            "text-text-primary text-sm leading-relaxed",
            "[&_h1]:text-lg [&_h1]:font-bold [&_h1]:mb-3 [&_h1]:mt-6 [&_h1]:text-text-primary",
            "[&_h2]:text-base [&_h2]:font-semibold [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-text-primary",
            "[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mb-1.5 [&_h3]:mt-4 [&_h3]:text-text-primary",
            "[&_p]:mb-3 [&_p]:text-text-secondary",
            "[&_ul]:mb-3 [&_ul]:pl-5 [&_ul]:list-disc [&_ul]:text-text-secondary",
            "[&_ol]:mb-3 [&_ol]:pl-5 [&_ol]:list-decimal [&_ol]:text-text-secondary",
            "[&_li]:mb-1",
            "[&_blockquote]:border-l-2 [&_blockquote]:border-accent [&_blockquote]:pl-3 [&_blockquote]:my-3 [&_blockquote]:italic [&_blockquote]:text-text-tertiary",
            "[&_hr]:border-border-subtle [&_hr]:my-4",
            "[&_strong]:font-semibold [&_strong]:text-text-primary",
            "[&_a]:text-accent [&_a]:underline",
            "[&_code]:bg-bg-overlay [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs"
          )}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </BottomSheetBody>
    </BottomSheet>
  );
}
