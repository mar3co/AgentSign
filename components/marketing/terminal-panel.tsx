import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function TerminalPanel({
  eyebrow,
  address,
  footer,
  className,
  children,
}: {
  eyebrow: string;
  address?: string;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-4 rounded-lg bg-terminal p-6 font-mono text-[13px] leading-relaxed text-ledger",
        className,
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[#7e97d8]">
          {eyebrow}
        </p>
        {address ? (
          <code className="text-[11.5px] text-[#55688f]">{address}</code>
        ) : null}
      </div>
      {children}
      {footer ? (
        <div className="mt-auto flex flex-col gap-2">
          <div className="h-px bg-[#22304a]" />
          {footer}
        </div>
      ) : null}
    </div>
  );
}
