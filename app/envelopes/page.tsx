import { CabinetClient } from "./cabinet-client";

export const runtime = "nodejs";

export default function EnvelopesPage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col gap-6 p-4">
      <header className="flex items-center justify-between">
        <p className="text-base font-medium">Sign</p>
        <a className="text-sm text-muted-foreground underline" href="/">
          Send a PDF
        </a>
      </header>
      <main className="flex flex-1 flex-col">
        <CabinetClient />
      </main>
      <footer className="pb-4 text-center text-sm text-muted-foreground">
        Sign
      </footer>
    </div>
  );
}
