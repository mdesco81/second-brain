import { Dialog, DialogHeader, DialogBody, DialogFooter } from "./Dialog";
import { Button } from "./Button";
import type { ReactNode } from "react";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: string;
  icon?: ReactNode;
  confirmText?: string;
  variant?: "danger" | "primary";
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  message,
  icon,
  confirmText = "Confirmar",
  variant = "danger",
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>{title}</DialogHeader>
      <DialogBody>
        <div className="flex flex-col items-center gap-3 text-center py-2">
          {icon && <span className="text-3xl">{icon}</span>}
          <p className="text-sm text-text-secondary">{message}</p>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          Cancelar
        </Button>
        <Button
          variant={variant === "danger" ? "danger" : "primary"}
          onClick={() => {
            onConfirm();
            onOpenChange(false);
          }}
        >
          {confirmText}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
