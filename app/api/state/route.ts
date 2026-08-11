import { guard } from "@/lib/api";
import { buildClientState } from "@/lib/state";
import { json } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = guard();
  if (denied) return denied;
  return json(await buildClientState());
}
