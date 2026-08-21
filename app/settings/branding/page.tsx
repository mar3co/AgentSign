import { PageShell } from "@/components/page-shell";
import { BrandingClient } from "./branding-client";

export const runtime = "nodejs";

export default function BrandingSettingsPage() {
  return (
    <PageShell variant="app">
      <BrandingClient />
    </PageShell>
  );
}
