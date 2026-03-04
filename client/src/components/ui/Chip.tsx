import { cn } from "@/lib/cn";
import type { ButtonHTMLAttributes } from "react";

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  variant?: "default" | "alta" | "media" | "baixa";
}

const activeVariantStyles: Record<string, string> = {
  default: "bg-accent text-white border-accent",
  alta: "bg-error-subtle text-error border-error/30",
  media: "bg-warning-subtle text-warning border-warning/30",
  baixa: "bg-success-subtle text-success border-success/30",
};

export function Chip({ active, variant = "default", className, children, ...props }: ChipProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border transition-all duration-150 cursor-pointer select-none whitespace-nowrap",
        active
          ? activeVariantStyles[variant]
          : "bg-transparent text-text-tertiary border-border-default hover:text-text-secondary hover:border-border-strong",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
