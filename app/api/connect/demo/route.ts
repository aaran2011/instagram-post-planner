import { json } from "@/lib/api";

export const dynamic = "force-dynamic";

// Demo connections were removed — connect your real accounts instead.
export async function POST() {
  return json({ error: "Demo connections have been removed. Please connect your real account." }, 410);
}
