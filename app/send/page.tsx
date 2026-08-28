import { SendClient } from "./send-client";

export const runtime = "nodejs";

// SendClient renders its own AppShell: the editor (canvas + step rail)
// while composing, the standard app shell for the confirm and done screens.
export default function SendPage() {
  return <SendClient />;
}
