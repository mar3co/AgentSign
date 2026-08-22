import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function TwoReader({
  human,
  machine,
  machineLabel = "View as machine",
  className,
}: {
  human: ReactNode;
  machine: ReactNode;
  machineLabel?: string;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "grid min-w-0 items-stretch gap-8 lg:grid-cols-[minmax(0,1fr)_1px_minmax(0,26rem)]",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-5">{human}</div>
      <div className="hidden w-px bg-tint/25 lg:block" />
      <details className="min-w-0 lg:hidden">
        <summary className="cursor-pointer font-mono text-xs uppercase tracking-[0.2em] text-tint">
          {machineLabel}
        </summary>
        <div className="mt-3">{machine}</div>
      </details>
      <div className="hidden min-w-0 lg:flex lg:flex-col">{machine}</div>
    </section>
  );
}
