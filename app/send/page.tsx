import { flagOn } from "@/src/lib/flags";
import { SendClient } from "./send-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SendClient renders its own AppShell: the editor (canvas + step rail)
// while composing, the standard app shell for the confirm and done screens.
export default async function SendPage() {
  return <SendClient aiDetect={await flagOn("ai_field_detect")} />;
}
