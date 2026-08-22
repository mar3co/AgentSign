export function AgentAside() {
  return (
    <aside className="flex flex-col gap-1 rounded-md border border-border bg-muted/50 p-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-tint">
        For agents &amp; developers
      </p>
      <p className="text-sm text-muted-foreground">
        Agents don&apos;t log in. They hold keys. Send with a throwaway sign_tmp_ key, or mint live
        keys after you log in.
      </p>
    </aside>
  );
}
