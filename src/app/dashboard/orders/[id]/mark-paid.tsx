"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "../../../_lib/format";

export function MarkPaidButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="stack">
      <div className="alert alert-warn small">Awaiting payment. If the customer paid by EFT or cash, record it here.</div>
      {error && <div className="alert alert-error small">{error}</div>}
      <button
        className="btn"
        disabled={busy}
        onClick={async () => {
          if (!confirm("Mark this order as paid? The customer will be notified.")) return;
          setBusy(true);
          try {
            await api(`/api/v1/orders/${orderId}/mark-paid`, { method: "POST", json: { reference: "manual" } });
            router.refresh();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Mark as paid
      </button>
    </div>
  );
}
