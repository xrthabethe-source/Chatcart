import { requireCurrentUser } from "@/server/http/context";
import { handle } from "@/server/http/respond";
import { exportPaxiRegistrationCsv } from "@/server/services/shipments";

// CSV of paid PAXI parcels awaiting registration on the PAXI portal.
export const GET = handle(async () => {
  const csv = await exportPaxiRegistrationCsv(await requireCurrentUser());
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="paxi-registration-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
});
