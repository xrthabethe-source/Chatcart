"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ShipmentStatus } from "@/server/delivery/types";
import { api } from "../../../_lib/format";

interface Actions {
  createShipment: boolean;
  enterTrackingReference: boolean;
  printLabel: boolean;
  trackParcel: boolean;
  cancel: boolean;
  setStatus: ShipmentStatus[];
}

const STATUS_BUTTON: Partial<Record<ShipmentStatus, string>> = {
  COLLECTED: "Courier collected",
  IN_TRANSIT: "In transit",
  READY_FOR_COLLECTION: "Ready for collection",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered / collected",
  EXCEPTION: "Report a problem",
};

export function ShipmentActionsPanel(props: {
  shipmentId: string;
  providerCode: string;
  actions: Actions;
  labelUrl: string | null;
  trackingUrl: string | null;
}) {
  const { shipmentId, providerCode, actions } = props;
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const isPaxi = providerCode === "PAXI";

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function copyDetails() {
    setError(null);
    try {
      const { text } = await api<{ text: string }>(`/api/v1/shipments/${shipmentId}/details`);
      setDetails(text);
      await navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="stack">
      {error && <div className="alert alert-error small" role="alert">{error}</div>}

      {actions.enterTrackingReference && (
        <form
          className="card-flat stack"
          action={(form) =>
            run("ref", () =>
              api(`/api/v1/shipments/${shipmentId}/tracking-reference`, {
                method: "POST",
                json: { trackingNumber: String(form.get("trackingNumber") ?? "") },
              }),
            )
          }
        >
          <div><strong>{isPaxi ? "Ready for PAXI registration" : "Book this parcel with the courier"}</strong></div>
          <span className="small muted">
            {isPaxi
              ? "Register the parcel on the PAXI portal using the shipping details below, then enter the PAXI tracking/reference number. The customer is notified automatically."
              : "Book it with the courier, then enter the waybill/tracking number."}
          </span>
          <div className="row">
            <input name="trackingNumber" placeholder={isPaxi ? "PAXI reference" : "Tracking number"} required minLength={3} style={{ flex: 1, minWidth: 180 }} />
            <button className="btn btn-primary" disabled={busy !== null}>{busy === "ref" ? "Saving…" : "Save reference"}</button>
          </div>
        </form>
      )}

      <div className="row">
        {actions.createShipment && (
          <button className="btn btn-primary" disabled={busy !== null} onClick={() => run("book", () => api(`/api/v1/shipments/${shipmentId}/book`, { method: "POST" }))}>
            {busy === "book" ? "Booking…" : "Book delivery"}
          </button>
        )}
        {actions.printLabel && props.labelUrl && (
          <a className="btn" href={props.labelUrl} target="_blank" rel="noreferrer">Print label</a>
        )}
        <button className="btn" onClick={copyDetails}>Copy shipping details</button>
        {actions.trackParcel && (
          <button className="btn" disabled={busy !== null} onClick={() => run("track", () => api(`/api/v1/shipments/${shipmentId}/refresh`, { method: "POST" }))}>
            {busy === "track" ? "Checking…" : "Track parcel"}
          </button>
        )}
        {props.trackingUrl && <a className="btn" href={props.trackingUrl} target="_blank" rel="noreferrer">Courier tracking page ↗</a>}
        {actions.cancel && (
          <button
            className="btn btn-danger"
            disabled={busy !== null}
            onClick={() => {
              const note = actions.createShipment || actions.trackParcel ? "" : "\n\nIf you already registered it on the courier's portal, cancel it there too.";
              if (confirm(`Cancel this shipment?${note}`)) run("cancel", () => api(`/api/v1/shipments/${shipmentId}/cancel`, { method: "POST" }));
            }}
          >
            Cancel shipment
          </button>
        )}
      </div>

      {details && (
        <div className="stack">
          <span className="small muted">{copied ? "Copied to clipboard ✓" : "Select and copy:"}</span>
          <pre className="copy">{details}</pre>
        </div>
      )}

      {actions.setStatus.length > 0 && (
        <div className="stack">
          <span className="small muted">Update delivery progress (the customer gets a WhatsApp update):</span>
          <div className="row">
            {actions.setStatus.map((status) => (
              <button
                key={status}
                className={`btn btn-sm${status === "EXCEPTION" ? " btn-danger" : ""}`}
                disabled={busy !== null}
                onClick={() => run(status, () => api(`/api/v1/shipments/${shipmentId}/status`, { method: "POST", json: { status } }))}
              >
                {STATUS_BUTTON[status] ?? status}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
