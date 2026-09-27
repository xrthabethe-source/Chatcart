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
  );
}
