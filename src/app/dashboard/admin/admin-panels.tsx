"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, dateTime, rands, toCents } from "../../_lib/format";

interface InviteRow { id: string; label: string | null; uses: number; maxUses: number; expiresAt: string }
interface Tariff { serviceCode: string; name: string; rateCents: number; etaMinDays: number; etaMaxDays: number }

export function AdminPanels({ invites, tariff, catalogueCount }: { invites: InviteRow[]; tariff: Tariff[] | null; catalogueCount: number }) {
  return (
    <div className="stack">
      <InvitePanel invites={invites} />
      <CataloguePanel count={catalogueCount} />
      <PaxiPanel initial={tariff} />
    </div>
  );
}

function InvitePanel({ invites }: { invites: InviteRow[] }) {
  const router = useRouter();
  const [created, setCreated] = useState<{ url: string; whatsappText: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  return (
    <section className="card stack" aria-labelledby="inv-h">
      <h2 id="inv-h">Invite an associate</h2>
      <p className="small muted">Creates a link they open on their phone to set up their shop in about 5 minutes. Links work once and expire after 14 days.</p>
      {error && <div className="alert alert-error small">{error}</div>}
      <form
        className="row"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setCopied(false);
          const label = String(new FormData(e.currentTarget).get("label") ?? "").trim();
          try {
            const { invite } = await api<{ invite: { url: string; whatsappText: string } }>("/api/v1/admin/invites", { method: "POST", json: { label: label || null } });
            setCreated(invite);
            router.refresh();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <input name="label" aria-label="Associate's first name" placeholder="Associate's first name, e.g. Sandile" style={{ flex: 1, minWidth: 200 }} />
        <button className="btn btn-primary">Create invite link</button>
      </form>
      {created && (
        <div className="flat">
          <div className="mono" style={{ wordBreak: "break-all" }}>{created.url}</div>
          <div className="row">
            <a className="btn btn-primary btn-sm" href={`https://wa.me/?text=${encodeURIComponent(created.whatsappText)}`} target="_blank" rel="noreferrer">Send on WhatsApp</a>
            <button className="btn btn-sm" onClick={async () => { try { await navigator.clipboard.writeText(created.whatsappText); setCopied(true); } catch { setCopied(false); } }}>
              {copied ? "Copied ✓" : "Copy message"}
            </button>
          </div>
        </div>
      )}
      {invites.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>For</th><th>Used</th><th>Expires</th></tr></thead>
            <tbody>
              {invites.map((i) => (
                <tr key={i.id}><td>{i.label ?? "—"}</td><td>{i.uses >= i.maxUses ? <span className="chip chip-ok">Shop opened</span> : <span className="chip">Not yet</span>}</td><td className="small">{dateTime(i.expiresAt)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function CataloguePanel({ count }: { count: number }) {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  return (
    <section className="card stack" aria-labelledby="cat-h">
      <h2 id="cat-h">Product catalogue</h2>
      <p className="small muted">
        {count} products in the catalogue. Associates tick what they stock during setup. Upload or paste a CSV with columns
        <span className="mono"> sku, name, price, description, image_url, category, weight_g, length_cm, width_cm, height_cm</span> (only sku, name and price are required; price in rands). Re-uploading updates products by SKU. Associates keep their own prices.
      </p>
      {result && <div className={`alert ${result.kind === "ok" ? "alert-ok" : "alert-error"} small`}>{result.text}</div>}
      <input
        type="file"
        accept=".csv,text/csv"
        aria-label="Catalogue CSV file"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) setCsv(await file.text());
        }}
      />
      <textarea rows={6} aria-label="Catalogue CSV" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={"sku,name,price,image_url\nGRW,GRW,850,https://…/grw.jpg"} />
      <div>
        <button
          className="btn btn-primary"
          disabled={!csv.trim()}
          onClick={async () => {
            setResult(null);
            try {
              const r = await api<{ created: number; updated: number }>("/api/v1/admin/catalogue", { method: "POST", json: { csv } });
              setResult({ kind: "ok", text: `Imported: ${r.created} new, ${r.updated} updated.` });
              router.refresh();
            } catch (err) {
              setResult({ kind: "error", text: (err as Error).message });
            }
          }}
        >
          Import catalogue
        </button>
      </div>
    </section>
  );
}

function PaxiPanel({ initial }: { initial: Tariff[] | null }) {
  const [rows, setRows] = useState<Tariff[]>(initial ?? [{ serviceCode: "STANDARD", name: "Standard", rateCents: 0, etaMinDays: 7, etaMaxDays: 9 }]);
  const [result, setResult] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const set = (i: number, patch: Partial<Tariff>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <section className="card stack" aria-labelledby="paxi-h">
      <h2 id="paxi-h">Default PEP / PAXI prices</h2>
      <p className="small muted">New associates start with these PAXI prices when they switch on PEP / PAXI during setup. Use PAXI&apos;s current prices. Existing shops keep their own.</p>
      {!initial && <div className="alert alert-warn small">Not set yet: associates can&apos;t switch on PEP / PAXI during setup until you save these.</div>}
      {result && <div className={`alert ${result.kind === "ok" ? "alert-ok" : "alert-error"} small`}>{result.text}</div>}
      {rows.map((r, i) => (
        <div key={i} className="grid-2" style={{ alignItems: "end" }}>
          <div><label htmlFor={`pt-n${i}`}>Service</label><input id={`pt-n${i}`} value={r.name} onChange={(e) => set(i, { name: e.target.value, serviceCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 40) || "STANDARD" })} /></div>
          <div><label htmlFor={`pt-p${i}`}>Price (R)</label><input id={`pt-p${i}`} inputMode="decimal" defaultValue={r.rateCents ? (r.rateCents / 100).toFixed(2) : ""} onBlur={(e) => set(i, { rateCents: toCents(e.target.value) ?? 0 })} /></div>
          <div>
            <label>Delivery time (working days)</label>
            <div className="row">
              <input aria-label="Minimum days" type="number" min={0} value={r.etaMinDays} onChange={(e) => set(i, { etaMinDays: Number(e.target.value) })} style={{ width: 80 }} />–
              <input aria-label="Maximum days" type="number" min={0} value={r.etaMaxDays} onChange={(e) => set(i, { etaMaxDays: Number(e.target.value) })} style={{ width: 80 }} />
            </div>
          </div>
          <div>{rows.length > 1 && <button className="btn btn-sm btn-danger" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>}</div>
        </div>
      ))}
      <div className="row">
        <button className="btn btn-sm" onClick={() => setRows([...rows, { serviceCode: `SERVICE_${rows.length + 1}`, name: "", rateCents: 0, etaMinDays: 3, etaMaxDays: 5 }])}>+ Add service</button>
        <button
          className="btn btn-primary"
          onClick={async () => {
            setResult(null);
            if (rows.some((r) => r.rateCents <= 0)) return setResult({ kind: "error", text: "Enter a price for every service." });
            try {
              await api("/api/v1/admin/paxi-prices", { method: "PUT", json: { tariff: rows } });
              setResult({ kind: "ok", text: `Saved: ${rows.map((r) => `${r.name} ${rands(r.rateCents)}`).join(", ")}.` });
            } catch (err) {
              setResult({ kind: "error", text: (err as Error).message });
            }
          }}
        >
          Save PAXI prices
        </button>
      </div>
    </section>
  );
}
