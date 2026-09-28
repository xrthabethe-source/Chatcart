"use client";
import { useEffect, useState } from "react";
import { api } from "../../_lib/format";

interface Props {
  orderId: string;
  orderNumber: string;
  initiallyPaid: boolean;
  result: string | null;
  cardPayments: boolean;
  paymentInstructions: string | null;
  sellerName: string;
  sellerWhatsAppUrl: string | null;
  simulate: boolean;
}

export function PayActions(props: Props) {
  const [paid, setPaid] = useState(props.initiallyPaid);
  const [waiting, setWaiting] = useState(props.result === "success" && !props.initiallyPaid);
  const [error, setError] = useState<string | null>(
    props.result === "failed" ? "The card payment didn't go through. You can try again." : props.result === "cancelled" ? "Payment cancelled. You can try again when you're ready." : null,
  );
  const [busy, setBusy] = useState(false);

  // Back from Yoco: the payment is confirmed by Yoco's webhook, usually
  // within seconds. Poll until it lands.
  useEffect(() => {
    if (!waiting) return;
    let tries = 0;
    const timer = setInterval(async () => {
      tries++;
      try {
        const { status } = await api<{ status: string }>(`/api/v1/pay/${props.orderId}/status`);
        if (status !== "PENDING_PAYMENT") {
          setPaid(true);
          setWaiting(false);
        }
      } catch {
        // keep trying
      }
      if (tries >= 30) setWaiting(false);
    }, 2000);
    return () => clearInterval(timer);
  }, [waiting, props.orderId]);

  const sellerLink = props.sellerWhatsAppUrl && (
    <a className="btn btn-block" href={props.sellerWhatsAppUrl} target="_blank" rel="noreferrer">💬 Send your order to {props.sellerName} on WhatsApp</a>
  );

  if (paid) {
    return (
      <div className="stack">
        <div className="alert alert-ok">✅ Paid, thank you! {props.sellerName} will get your order ready. We&apos;ll send delivery updates on WhatsApp.</div>
        {sellerLink}
      </div>
    );
  }
  if (waiting) {
    return <div className="alert alert-warn" role="status">Confirming your payment… this usually takes a few seconds.</div>;
  }

  return (
    <div className="stack">
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {props.cardPayments && (
        <button
          className="btn btn-primary btn-block"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const { redirectUrl } = await api<{ redirectUrl: string }>(`/api/v1/pay/${props.orderId}/yoco`, { method: "POST" });
              window.location.href = redirectUrl;
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          {busy ? "Opening secure payment…" : "💳 Pay securely by card"}
        </button>
      )}
      {props.paymentInstructions && (
        <div className="card stack">
          <strong>{props.cardPayments ? "Or pay by EFT / cash" : "How to pay"}</strong>
          <pre className="copy">{props.paymentInstructions.replaceAll("{order}", props.orderNumber)}</pre>
          <span className="small muted">Use <strong>{props.orderNumber}</strong> as your reference. {props.sellerName} will confirm when the payment arrives.</span>
        </div>
      )}
      {!props.cardPayments && !props.paymentInstructions && (
        <div className="alert alert-warn">Online payment isn&apos;t set up for this shop yet. Please contact {props.sellerName} to pay.</div>
      )}
      {sellerLink}
      {props.simulate && (
        <button
          className="btn btn-sm"
          onClick={async () => {
            await api(`/api/v1/pay/${props.orderId}/simulate`, { method: "POST" });
            setPaid(true);
          }}
        >
          (Development) Simulate successful payment
        </button>
      )}
    </div>
  );
}
