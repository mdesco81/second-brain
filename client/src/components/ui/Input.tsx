import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full rounded-md border border-border-default bg-bg-surface px-3 py-2 text-sm text-text-primary",
        "placeholder:text-text-tertiary",
        "focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        "transition-colors duration-150",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";
