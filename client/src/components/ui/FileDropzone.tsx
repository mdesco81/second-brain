import { useState, useRef, type DragEvent, type ChangeEvent } from "react";
import { cn } from "@/lib/cn";
import { Upload } from "lucide-react";

interface FileDropzoneProps {
  accept?: string;
  maxSize?: number;
  onFileSelect: (file: File) => void;
  className?: string;
  hint?: string;
}

export function FileDropzone({ accept, maxSize, onFileSelect, className, hint }: FileDropzoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    if (maxSize && file.size > maxSize) return;
    setSelectedFile(file);
    onFileSelect(file);
  }

  function onDragOver(e: DragEvent) { e.preventDefault(); setIsDragOver(true); }
  function onDragLeave() { setIsDragOver(false); }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  }
  function onChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <div
      className={cn(
        "rounded-lg border-2 border-dashed border-border-default bg-bg-surface p-6 text-center cursor-pointer transition-colors",
        isDragOver && "border-accent bg-accent-subtle",
        selectedFile && "border-success/30",
        className
      )}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
    >
      <Upload className="h-8 w-8 text-text-tertiary mx-auto mb-2" />
      <p className="text-sm text-text-secondary mb-1">
        {selectedFile ? selectedFile.name : "Arraste um arquivo aqui ou clique para selecionar"}
      </p>
      <p className="text-xs text-text-tertiary">
        {selectedFile
          ? `${(selectedFile.size / 1024).toFixed(0)} KB — Clique para trocar`
          : hint || "PDF, Markdown ou Texto"}
      </p>
      <input ref={inputRef} type="file" accept={accept} onChange={onChange} className="hidden" />
    </div>
  );
}
