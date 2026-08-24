import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

function terminalLineClass(line: string) {
  const t = line.trimStart();
  if (t.startsWith("#") || t.startsWith(">")) return "text-[#9bb6f0]";
  if (t.startsWith("{") || t.startsWith("}")) return "text-[#d8e4fa]";
  return "font-medium text-[#eef3fc]";
}

export function TerminalCode({ code }: { code: string }) {
  const lines = code.replace(/\n$/, "").split("\n");
  return (
    <pre className="shrink-0 overflow-x-auto whitespace-pre">
      {lines.map((line, i) => (
        <span key={i} className={terminalLineClass(line)}>
          {line}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

export const TERMINAL_FOOTER_LINK =
  "text-[#d8e4fa] underline-offset-4 hover:underline";

export function TerminalFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 text-[13.5px] leading-relaxed text-[#c5d4f5] text-pretty">
      {children}
    </div>
  );
}

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
        "flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto rounded-lg bg-terminal p-5 font-mono text-[13px] leading-[1.65] text-[#eef3fc] xl:gap-5 xl:p-6 xl:text-[14px] xl:leading-[1.7]",
        className,
      )}
    >
      <div className="flex shrink-0 flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[#9bb6f0]">
          {eyebrow}
        </p>
        {address ? (
          <code className="text-[13px] text-[#c5d4f5]">{address}</code>
        ) : null}
      </div>
      {children}
      {footer ? (
        <div className="mt-auto flex shrink-0 flex-col gap-2.5">
          <div className="h-px bg-[#33476a]" />
          {footer}
        </div>
      ) : null}
    </div>
  );
}
