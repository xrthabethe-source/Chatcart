"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "../../_lib/format";

interface Settings {
  name: string;
  slug: string;
  sellerDisplayName: string | null;
  orderPrefix: string;
  whatsappPhoneId: string | null;
  whatsappNumber: string | null;
  yocoConnected: boolean;
  yocoTestMode: boolean;
  paymentInstructions: string | null;
  canLinkWhatsApp: boolean;
  whatsappConfigured: boolean;
}

export function ShopSettingsForm({ initial }: { initial: Settings }) {
  const router = useRouter();
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(form: FormData) {
    setBusy(true);
    setStatus(null);
    const body: Record<string, unknown> = {
      name: form.get("name"),
      sellerDisplayName: String(form.get("sellerDisplayName") ?? "").trim() || null,
      orderPrefix: form.get("orderPrefix"),
      whatsappNumber: String(form.get("whatsappNumber") ?? "").trim() || null,
    };
    if (initial.canLinkWhatsApp) body.whatsappPhoneId = String(form.get("whatsappPhoneId") ?? "").trim() || null;
    try {
      const res = await api<{ settings: Settings & { linkedNumber: string | null } }>("/api/v1/shop-settings", { method: "PATCH", json: body });
      setStatus({ kind: "ok", text: res.settings.linkedNumber ? `Saved. WhatsApp number ${res.settings.linkedNumber} is linked to this shop.` : "Saved." });
      router.refresh();
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <form className="stack" action={save}>
      {status && <div className={`alert ${status.kind === "ok" ? "alert-ok" : "alert-error"}`} role="status">{status.text}</div>}
      <section className="card stack">
        <h2>Your shop</h2>
        <div className="grid-2">
          <div><label htmlFor="s-name">Shop name</label><input id="s-name" name="name" defaultValue={initial.name} required minLength={2} /></div>
          <div>
            <label htmlFor="s-seller">Your first name</label>
            <input id="s-seller" name="sellerDisplayName" defaultValue={initial.sellerDisplayName ?? ""} />
            <p className="small muted">Customers see “Collect from {initial.sellerDisplayName || "…"}”.</p>
          </div>
          <div>
            <label htmlFor="s-prefix">Order number prefix</label>
            <input id="s-prefix" name="orderPrefix" defaultValue={initial.orderPrefix} required pattern="[A-Za-z]{2,6}" style={{ textTransform: "uppercase" }} />
            <p className="small muted">New orders will be numbered like {initial.orderPrefix}-1048.</p>
          </div>
        </div>
        <p className="small muted">Your shop link: <span className="mono">/shop/{initial.slug}</span></p>
      </section>

      <section className="card stack">
        <h2>WhatsApp</h2>
        <div>
          <label htmlFor="s-wanum">Your WhatsApp number</label>
          <input id="s-wanum" name="whatsappNumber" inputMode="tel" defaultValue={initial.whatsappNumber ? `0${initial.whatsappNumber.slice(2)}` : ""} placeholder="082 123 4567" />
          <p className="small muted">Customers tap “Chat with you” to reach this number, and new paid orders are sent to it.</p>
        </div>
        {!initial.whatsappConfigured && (
          <div className="alert alert-warn small">WhatsApp isn&apos;t connected on this platform yet (the Meta access token and app secret aren&apos;t set), so messages are only logged.</div>
        )}
        {initial.canLinkWhatsApp ? (
          <div>
            <label htmlFor="s-wa">WhatsApp phone number ID</label>
            <input id="s-wa" name="whatsappPhoneId" inputMode="numeric" defaultValue={initial.whatsappPhoneId ?? ""} placeholder="e.g. 106540352242922" />
            <p className="small muted">From Meta: WhatsApp → API Setup → “Phone number ID” (not the phone number itself). Leave empty to unlink.</p>
          </div>
        ) : initial.whatsappPhoneId ? (
          <p>✓ A WhatsApp number is linked to this shop.</p>
        ) : (
          <p className="muted">No WhatsApp number linked yet. The platform administrator links it for you.</p>
        )}
      </section>
      <div><button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>
    </form>
    <PaymentsSection initial={initial} />
    </>
  );
}

function PaymentsSection({ initial }: { initial: Settings }) {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [instructions, setInstructions] = useState(initial.paymentInstructions ?? "");
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setStatus(null);
    try {
      await fn();
      setStatus({ kind: "ok", text: ok });
      setKey("");
      router.refresh();
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
    }
  };
  return (
    <section className="card stack" aria-labelledby="pay-h">
      <h2 id="pay-h">Payments</h2>
      {status && <div className={`alert ${status.kind === "ok" ? "alert-ok" : "alert-error"} small`} role="status">{status.text}</div>}
      <div className="flat stack">
        <strong>Card payments (Yoco)</strong>
        {initial.yocoConnected ? (
          <span className="small">✓ Connected{initial.yocoTestMode ? " with a TEST key: no real money is taken" : ""}. Card payments go straight into your Yoco account.</span>
        ) : (
          <span className="small muted">Not connected. Paste your Yoco secret key (starts with sk_live_).</span>
        )}
        <div className="row">
          <input aria-label="Yoco secret key" value={key} onChange={(e) => setKey(e.target.value)} placeholder={initial.yocoConnected ? "Paste a new key to replace it" : "sk_live_…"} autoComplete="off" spellCheck={false} style={{ flex: 1, minWidth: 200 }} />
          <button type="button" className="btn" disabled={!key.trim()} onClick={() => act(() => api("/api/v1/payments/yoco", { method: "POST", json: { secretKey: key.trim() } }), "Yoco connected.")}>
            {initial.yocoConnected ? "Replace key" : "Connect Yoco"}
          </button>
          {initial.yocoConnected && (
            <button type="button" className="btn btn-danger" onClick={() => act(() => api("/api/v1/payments/yoco", { method: "DELETE" }), "Yoco disconnected.")}>Disconnect</button>
          )}
        </div>
      </div>
      <div className="flat stack">
        <label htmlFor="s-eft">EFT / cash instructions (shown after ordering)</label>
        <textarea id="s-eft" rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder={"EFT to: FNB 62xxxxxxx (S Mokoena)\nUse your order number as reference."} />
        <div>
          <button type="button" className="btn" onClick={() => act(() => api("/api/v1/payments", { method: "PATCH", json: { paymentInstructions: instructions.trim() || null } }), "Saved.")}>
            Save instructions
          </button>
        </div>
      </div>
    </section>
  );
}
