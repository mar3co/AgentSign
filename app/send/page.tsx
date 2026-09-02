import { appOrigin, getEnv } from "@/src/env";
import { flagOn } from "@/src/lib/flags";
import { SendClient } from "./send-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SendClient renders its own AppShell: the editor (canvas + step rail)
// while composing, the standard app shell for the confirm and done screens.
export default async function SendPage() {
  // The origin the invite emails use, so a copied signing link matches the
  // emailed one. Null when unconfigured: the client then uses this tab.
  const env = getEnv();
  const origin = env.APP_URL || env.APP_ORIGIN ? appOrigin() : null;
  return (
    <SendClient aiDetect={await flagOn("ai_field_detect")} origin={origin} />
  );
}
