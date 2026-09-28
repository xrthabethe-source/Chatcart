import { notFound } from "next/navigation";
import { requireCurrentUser } from "@/server/http/context";
import { isPlatformAdmin } from "@/server/services/auth";
import { listInvites } from "@/server/services/invites";
import { getDefaultPaxiTariff } from "@/server/services/platform-settings";
import { countActiveCatalogue } from "@/server/services/catalogue";
import { AdminPanels } from "./admin-panels";

export default async function AdminPage() {
  const user = await requireCurrentUser();
  if (!isPlatformAdmin(user)) notFound();
  const [invites, tariff, catalogueCount] = await Promise.all([
    listInvites(user),
    getDefaultPaxiTariff(),
    countActiveCatalogue(),
  ]);
  return (
    <main className="container stack">
      <h1>Platform admin</h1>
      <AdminPanels
        invites={invites.map((i) => ({ id: i.id, label: i.label, uses: i.uses, maxUses: i.maxUses, expiresAt: i.expiresAt.toISOString() }))}
        tariff={tariff}
        catalogueCount={catalogueCount}
      />
    </main>
  );
}
