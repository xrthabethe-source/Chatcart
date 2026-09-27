"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "../../_lib/format";

// Development stand-in for a payment gateway redirect.
export function SimulatePayment({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="stack">
      <div className="alert alert-warn small">Development mode: no payment gateway is connected.</div>
      {error && <div className="alert alert-error small">{error}</div>}
      <button
        className="btn btn-primary btn-block"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api(`/api/v1/pay/${orderId}/simulate`, { method: "POST" });
            router.refresh();
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        Simulate successful payment
      </button>
    </div>
  );
}
