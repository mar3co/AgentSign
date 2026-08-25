import { cookies } from "next/headers";
import { PageShell } from "@/components/page-shell";
import { SettingsSection, SettingsShell } from "@/components/settings-shell";
import { entitledForCookie } from "../../../src/lib/portal.js";
import { BrandingClient } from "./branding-client";

export const runtime = "nodejs";

export default async function BrandingSettingsPage() {
  const jar = await cookies();
  const header = jar
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const entitled = await entitledForCookie(header || null);
  return (
    <PageShell variant="app" width="xl">
      <SettingsShell current="branding">
        <SettingsSection
          title="Branding"
          description="How your documents look to signers. Shown on invite mail and the signing page, not the sealed PDF."
        >
          <BrandingClient initialEntitled={entitled} />
        </SettingsSection>
      </SettingsShell>
    </PageShell>
  );
}
