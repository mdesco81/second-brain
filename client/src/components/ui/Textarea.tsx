import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-md border border-border-default bg-bg-surface px-3 py-2 text-sm text-text-primary",
        "placeholder:text-text-tertiary",
        "focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        "transition-colors duration-150 resize-y min-h-[80px]",
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";
