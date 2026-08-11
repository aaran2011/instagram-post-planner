import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { config } from "@/lib/config";
import { buildClientState } from "@/lib/state";
import AppShell from "@/components/AppShell";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!getSession()) redirect("/login");
  const initial = await buildClientState();
  return <AppShell initial={initial} email={config.appEmail} />;
}
