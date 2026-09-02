"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

type CopyState = "idle" | "copied" | "failed";

// A value the reader must save now: a one-time key or a link that signs as
// someone. Labelled, monospaced, with one copy button and one line of advice.
export function SecretBlock({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  const [state, setState] = useState<CopyState>("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      // No clipboard (plain-http self-host, older browser): the value is
      // selectable, so say so.
      setState("failed");
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          {state === "copied" ? <Check aria-hidden /> : <Copy aria-hidden />}
          {state === "copied" ? "Copied" : "Copy"}
          <span className="sr-only"> {label}</span>
        </Button>
      </div>
      <code className="block overflow-x-auto rounded-md border border-border bg-muted/50 px-3 py-2 font-mono text-[13px] leading-relaxed break-all select-all">
        {value}
      </code>
      {state === "failed" ? (
        <p className="text-sm text-muted-foreground">
          Copy is not available here. Select the text and copy it yourself.
        </p>
      ) : note ? (
        <p className="text-sm text-muted-foreground">{note}</p>
      ) : null}
    </div>
  );
}
