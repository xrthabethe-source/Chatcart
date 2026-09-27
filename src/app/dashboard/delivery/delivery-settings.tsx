"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, rands, toCents } from "../../_lib/format";

type Method = "PAXI_PICKUP" | "DOOR_COURIER" | "SAME_DAY" | "SELLER_COLLECTION";

interface ProviderSettings {
  id: string;
  enabled: boolean;
  methods: Method[];
  mode: "INTEGRATED" | "ASSISTED";
  hasCredentials: boolean;
  pricingMode: "EXACT" | "RATE_PLUS_HANDLING";
  handlingFeeCents: number;
  markupBps: number;
  freeShippingThresholdCents: number | null;
  dispatchStreet: string | null;
  dispatchSuburb: string | null;
  dispatchCity: string | null;
  dispatchProvince: string | null;
  dispatchPostcode: string | null;
  dispatchLatitude: number | null;
  dispatchLongitude: number | null;
  dispatchContactName: string | null;
  dispatchContactPhone: string | null;
  defaultParcelLengthCm: number;
  defaultParcelWidthCm: number;
  defaultParcelHeightCm: number;
  defaultParcelWeightGrams: number;
  handlingTimeDays: number;
  config: Record<string, unknown>;
  provider: { code: string; name: string };
  capabilities: { pickupPoints: boolean; doorDelivery: boolean; sameDay: boolean; assistedMode: boolean };
}

const METHOD_LABEL: Record<Method, string> = {
  PAXI_PICKUP: "Collect at PEP / PAXI",
  DOOR_COURIER: "Courier to door",
  SAME_DAY: "Same-day delivery",
  SELLER_COLLECTION: "Collect from you",
};

const GROUPS: { title: string; blurb: string; match: (code: string) => boolean }[] = [
  { title: "PAXI / PEP", blurb: "Customers collect from a PEP store or PAXI Point near them — the most popular option.", match: (c) => c === "PAXI" },
  { title: "The Courier Guy", blurb: "Door-to-door courier with live rates, waybills, labels and tracking.", match: (c) => c === "COURIER_GUY" },
  { title: "Same-Day", blurb: "Same-day couriers. Same-day is only offered when the courier confirms it for the customer's address.", match: (c) => c.startsWith("LOCAL_COURIER") },
  { title: "Own Delivery", blurb: "You deliver yourself, inside an area you choose.", match: (c) => c === "OWN_DELIVERY" },
  { title: "Customer Collection", blurb: "Customers collect from your address.", match: (c) => c === "SELLER_COLLECTION" },
];

export function DeliverySettings({ providers }: { providers: ProviderSettings[] }) {
  return (
    <div className="stack">
      {GROUPS.map((group) => {
        const rows = providers.filter((p) => group.match(p.provider.code));
        if (rows.length === 0) return null;
        return (
          <section key={group.title} className="stack" aria-label={group.title}>
            <div>
              <h2 style={{ marginBottom: 2 }}>{group.title}</h2>
              <p className="small muted">{group.blurb}</p>
            </div>
            {rows.map((p) => <ProviderCard key={p.id} initial={p} others={providers.filter((o) => o.id !== p.id)} />)}
          </section>
        );
      })}
    </div>
  );
}

function supported(p: ProviderSettings): Method[] {
  const m: Method[] = [];
  if (p.capabilities.pickupPoints) m.push("PAXI_PICKUP");
  if (p.capabilities.doorDelivery) m.push("DOOR_COURIER");
  if (p.capabilities.sameDay) m.push("SAME_DAY");
  if (p.provider.code === "SELLER_COLLECTION") m.push("SELLER_COLLECTION");
  return m;
}

const centsToInput = (c: number | null | undefined) => (c === null || c === undefined ? "" : (c / 100).toFixed(2).replace(/\.00$/, ""));

function ProviderCard({ initial, others }: { initial: ProviderSettings; others: ProviderSettings[] }) {
  const router = useRouter();
  const [p, setP] = useState(initial);
  const [open, setOpen] = useState(initial.enabled);
  const [apiKey, setApiKey] = useState("");
  const [freeOn, setFreeOn] = useState(initial.freeShippingThresholdCents !== null);
  const [freeOver, setFreeOver] = useState(centsToInput(initial.freeShippingThresholdCents));
  const [fee, setFee] = useState(centsToInput(initial.handlingFeeCents));
  const [markup, setMarkup] = useState(String(initial.markupBps / 100));
  const [config, setConfig] = useState<Record<string, unknown>>(initial.config ?? {});
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const code = p.provider.code;
  const methods = supported(p);
  const needsCredentials = !p.capabilities.assistedMode || p.mode === "INTEGRATED";
  const set = <K extends keyof ProviderSettings>(key: K, value: ProviderSettings[K]) => setP((prev) => ({ ...prev, [key]: value }));

  async function save(overrides: Partial<ProviderSettings> = {}) {
    setBusy(true);
    setStatus(null);
    const next = { ...p, ...overrides };
    const handlingFeeCents = next.pricingMode === "RATE_PLUS_HANDLING" ? toCents(fee) ?? 0 : 0;
    const markupBps = next.pricingMode === "RATE_PLUS_HANDLING" ? Math.round(Number(markup || 0) * 100) : 0;
    const threshold = freeOn ? toCents(freeOver) : null;
    if (freeOn && threshold === null) {
      setBusy(false);
      return setStatus({ kind: "error", text: "Enter the order amount for free delivery." });
    }
    try {
      const { provider } = await api<{ provider: ProviderSettings }>(`/api/v1/delivery/settings/${p.id}`, {
        method: "PATCH",
        json: {
          enabled: next.enabled,
          methods: next.methods,
          mode: next.mode,
          ...(apiKey.trim() ? { credentials: { apiKey: apiKey.trim() } } : {}),
          pricingMode: next.pricingMode,
          handlingFeeCents,
          markupBps,
          freeShippingThresholdCents: threshold,
          dispatchStreet: next.dispatchStreet,
          dispatchSuburb: next.dispatchSuburb,
          dispatchCity: next.dispatchCity,
          dispatchProvince: next.dispatchProvince,
          dispatchPostcode: next.dispatchPostcode,
          dispatchLatitude: next.dispatchLatitude,
          dispatchLongitude: next.dispatchLongitude,
          dispatchContactName: next.dispatchContactName,
          dispatchContactPhone: next.dispatchContactPhone,
          defaultParcelLengthCm: next.defaultParcelLengthCm,
          defaultParcelWidthCm: next.defaultParcelWidthCm,
          defaultParcelHeightCm: next.defaultParcelHeightCm,
          defaultParcelWeightGrams: next.defaultParcelWeightGrams,
          handlingTimeDays: next.handlingTimeDays,
          config,
        },
      });
      setP(provider);
      setApiKey("");
      setStatus({ kind: "ok", text: provider.enabled ? "Saved — customers can now choose this." : "Saved." });
      router.refresh();
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const copySource = others.find((o) => o.dispatchStreet);

  return (
    <div className="card stack">
      <div className="spread">
        <div>
          <strong>{p.provider.name}</strong>{" "}
          {p.enabled ? <span className="chip chip-ok">On</span> : <span className="chip">Off</span>}
          {p.enabled && p.capabilities.assistedMode && code !== "OWN_DELIVERY" && code !== "SELLER_COLLECTION" && (
            <span className="chip" style={{ marginLeft: 6 }}>{p.mode === "ASSISTED" ? "Assisted dispatch" : "API connected"}</span>
          )}
        </div>
        <div className="row">
          <button className="btn btn-sm" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Hide settings" : "Settings"}</button>
          <button className={`btn btn-sm${p.enabled ? "" : " btn-primary"}`} disabled={busy} onClick={() => { setOpen(true); save({ enabled: !p.enabled }); }}>
            {p.enabled ? "Turn off" : "Turn on"}
          </button>
        </div>
      </div>
      {status && <div className={`alert ${status.kind === "ok" ? "alert-ok" : "alert-error"} small`} role="status">{status.text}</div>}

      {open && (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); save(); }}>
          {methods.length > 1 && (
            <fieldset className="card-flat">
              <legend className="small"><strong>Offer this provider for</strong></legend>
              {methods.map((m) => (
                <label key={m} className="check">
                  <input type="checkbox" checked={p.methods.includes(m)} onChange={(e) => set("methods", e.target.checked ? [...p.methods, m] : p.methods.filter((x) => x !== m))} />
                  {METHOD_LABEL[m]}
                </label>
              ))}
            </fieldset>
          )}

          {code === "PAXI" && (
            <fieldset className="card-flat stack">
              <legend className="small"><strong>How PAXI is connected</strong></legend>
              <label className="check">
                <input type="radio" name={`mode-${p.id}`} checked={p.mode === "ASSISTED"} onChange={() => set("mode", "ASSISTED")} />
                <span>Assisted — no PAXI API yet. Customers still pick a PAXI Point; you register paid parcels on the PAXI portal and enter the reference.</span>
              </label>
              <label className="check">
                <input type="radio" name={`mode-${p.id}`} checked={p.mode === "INTEGRATED"} onChange={() => set("mode", "INTEGRATED")} />
                <span>Integrated — use my PAXI API access for points, prices, bookings and tracking.</span>
              </label>
            </fieldset>
          )}

          {needsCredentials && code !== "OWN_DELIVERY" && code !== "SELLER_COLLECTION" && (
            <div>
              <label htmlFor={`key-${p.id}`}>API key</label>
              <input
                id={`key-${p.id}`}
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={p.hasCredentials ? "Saved ✓ — enter a new key to replace it" : `Your ${p.provider.name} API key`}
              />
              <p className="small muted">Stored encrypted. It&apos;s never shown again.</p>
            </div>
          )}

          <ProviderConfig code={code} mode={p.mode} config={config} setConfig={setConfig} />

          {code !== "SELLER_COLLECTION" && code !== "OWN_DELIVERY" && (
            <fieldset className="card-flat stack">
              <legend className="small"><strong>What the customer pays</strong></legend>
              <label className="check">
                <input type="radio" name={`pm-${p.id}`} checked={p.pricingMode === "EXACT"} onChange={() => set("pricingMode", "EXACT")} />
                Customer pays the exact courier rate
              </label>
              <label className="check">
                <input type="radio" name={`pm-${p.id}`} checked={p.pricingMode === "RATE_PLUS_HANDLING"} onChange={() => set("pricingMode", "RATE_PLUS_HANDLING")} />
                Customer pays courier rate + handling
              </label>
              {p.pricingMode === "RATE_PLUS_HANDLING" && (
                <div className="grid-2">
                  <div><label htmlFor={`fee-${p.id}`}>Handling fee (R)</label><input id={`fee-${p.id}`} inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} /></div>
                  <div><label htmlFor={`mk-${p.id}`}>Markup (%)</label><input id={`mk-${p.id}`} type="number" min={0} max={100} step="0.5" value={markup} onChange={(e) => setMarkup(e.target.value)} /></div>
                </div>
              )}
            </fieldset>
          )}
          {code !== "SELLER_COLLECTION" && (
            <div className="card-flat stack">
              <label className="check">
                <input type="checkbox" checked={freeOn} onChange={(e) => setFreeOn(e.target.checked)} />
                Free delivery on orders over a set amount
              </label>
              {freeOn && (
                <div><label htmlFor={`free-${p.id}`}>Free delivery over (R)</label><input id={`free-${p.id}`} inputMode="decimal" value={freeOver} onChange={(e) => setFreeOver(e.target.value)} placeholder="500" /></div>
              )}
            </div>
          )}

          <fieldset className="card-flat stack">
            <legend className="small"><strong>{code === "SELLER_COLLECTION" ? "Collection address" : "Pickup / dispatch address"}</strong></legend>
            {copySource && !p.dispatchStreet && (
              <button type="button" className="btn btn-sm" onClick={() => setP((prev) => ({ ...prev, ...pickAddress(copySource) }))}>
                Use the address from {copySource.provider.name}
              </button>
            )}
            <div className="grid-2">
              <TextField id={`st-${p.id}`} label="Street address" value={p.dispatchStreet} onChange={(v) => set("dispatchStreet", v)} />
              <TextField id={`sb-${p.id}`} label="Suburb" value={p.dispatchSuburb} onChange={(v) => set("dispatchSuburb", v)} />
              <TextField id={`ct-${p.id}`} label="Town / city" value={p.dispatchCity} onChange={(v) => set("dispatchCity", v)} />
              <TextField id={`pv-${p.id}`} label="Province" value={p.dispatchProvince} onChange={(v) => set("dispatchProvince", v)} />
              <TextField id={`pc-${p.id}`} label="Postcode" value={p.dispatchPostcode} onChange={(v) => set("dispatchPostcode", v)} />
              <TextField id={`cn-${p.id}`} label="Contact name" value={p.dispatchContactName} onChange={(v) => set("dispatchContactName", v)} />
              <TextField id={`cp-${p.id}`} label="Contact phone" value={p.dispatchContactPhone} onChange={(v) => set("dispatchContactPhone", v)} />
            </div>
            {(code === "OWN_DELIVERY") && (
              <div className="grid-2">
                <NumField id={`lat-${p.id}`} label="Latitude (for delivery radius)" value={p.dispatchLatitude} step="any" onChange={(v) => set("dispatchLatitude", v)} />
                <NumField id={`lng-${p.id}`} label="Longitude" value={p.dispatchLongitude} step="any" onChange={(v) => set("dispatchLongitude", v)} />
              </div>
            )}
          </fieldset>

          {code !== "SELLER_COLLECTION" && (
            <details className="card-flat">
              <summary className="small"><strong>Default parcel and handling time</strong></summary>
              <p className="small muted" style={{ marginTop: 8 }}>Used when products don&apos;t have their own size and weight.</p>
              <div className="grid-2">
                <NumField id={`dl-${p.id}`} label="Length (cm)" value={p.defaultParcelLengthCm} onChange={(v) => set("defaultParcelLengthCm", v ?? 1)} />
                <NumField id={`dw-${p.id}`} label="Width (cm)" value={p.defaultParcelWidthCm} onChange={(v) => set("defaultParcelWidthCm", v ?? 1)} />
                <NumField id={`dh-${p.id}`} label="Height (cm)" value={p.defaultParcelHeightCm} onChange={(v) => set("defaultParcelHeightCm", v ?? 1)} />
                <NumField id={`dg-${p.id}`} label="Weight (g)" value={p.defaultParcelWeightGrams} onChange={(v) => set("defaultParcelWeightGrams", v ?? 1)} />
                <NumField id={`ht-${p.id}`} label="Handling time (working days)" value={p.handlingTimeDays} onChange={(v) => set("handlingTimeDays", v ?? 0)} />
              </div>
            </details>
          )}

          <div><button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>
        </form>
      )}
    </div>
  );
}

function pickAddress(o: ProviderSettings): Partial<ProviderSettings> {
  return {
    dispatchStreet: o.dispatchStreet, dispatchSuburb: o.dispatchSuburb, dispatchCity: o.dispatchCity, dispatchProvince: o.dispatchProvince,
    dispatchPostcode: o.dispatchPostcode, dispatchLatitude: o.dispatchLatitude, dispatchLongitude: o.dispatchLongitude,
    dispatchContactName: o.dispatchContactName, dispatchContactPhone: o.dispatchContactPhone,
  };
}

function TextField({ id, label, value, onChange }: { id: string; label: string; value: string | null; onChange: (v: string | null) => void }) {
  return <div><label htmlFor={id}>{label}</label><input id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} /></div>;
}

function NumField({ id, label, value, onChange, step }: { id: string; label: string; value: number | null; onChange: (v: number | null) => void; step?: string }) {
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <input id={id} type="number" step={step ?? "1"} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />
    </div>
  );
}

// ─── Provider-specific settings ─────────────────────────────────────

interface Tariff { serviceCode: string; name: string; rateCents: number; etaMinDays: number; etaMaxDays: number }

function ProviderConfig({ code, mode, config, setConfig }: { code: string; mode: string; config: Record<string, unknown>; setConfig: (c: Record<string, unknown>) => void }) {
  const patch = (values: Record<string, unknown>) => setConfig({ ...config, ...values });

  if (code === "PAXI") {
    const tariff = (config.tariff as Tariff[] | undefined) ?? [];
    const api = (config.api as { baseUrl?: string } | undefined) ?? {};
    const setRow = (i: number, row: Partial<Tariff>) => patch({ tariff: tariff.map((t, j) => (j === i ? { ...t, ...row } : t)) });
    return (
      <div className="card-flat stack">
        {mode === "ASSISTED" ? (
          <>
            <strong className="small">Your PAXI prices</strong>
            <p className="small muted">Enter what you pay PAXI per parcel for each service you use. Customers see these prices (plus your rules below).</p>
            {tariff.map((t, i) => (
              <div key={i} className="grid-2" style={{ alignItems: "end" }}>
                <div><label>Service name</label><input value={t.name} onChange={(e) => setRow(i, { name: e.target.value, serviceCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 40) || "STD" })} /></div>
                <div><label>Price (R)</label><input inputMode="decimal" defaultValue={centsToInput(t.rateCents)} onBlur={(e) => setRow(i, { rateCents: toCents(e.target.value) ?? 0 })} /></div>
                <div><label>Delivery time (working days)</label>
                  <div className="row">
                    <input type="number" min={0} value={t.etaMinDays} onChange={(e) => setRow(i, { etaMinDays: Number(e.target.value) })} style={{ width: 80 }} />–
                    <input type="number" min={0} value={t.etaMaxDays} onChange={(e) => setRow(i, { etaMaxDays: Number(e.target.value) })} style={{ width: 80 }} />
                  </div>
                </div>
                <div><button type="button" className="btn btn-sm btn-danger" onClick={() => patch({ tariff: tariff.filter((_, j) => j !== i) })}>Remove</button></div>
              </div>
            ))}
            <div>
              <button type="button" className="btn btn-sm" onClick={() => patch({ tariff: [...tariff, { serviceCode: tariff.length ? `SERVICE_${tariff.length + 1}` : "STANDARD", name: tariff.length ? "" : "Standard", rateCents: 0, etaMinDays: 7, etaMaxDays: 9 }] })}>
                + Add PAXI price
              </button>
              {tariff.length > 0 && <span className="small muted" style={{ marginLeft: 8 }}>e.g. {tariff.map((t) => `${t.name || "?"} ${rands(t.rateCents)}`).join(", ")}</span>}
            </div>
          </>
        ) : (
          <div><label>PAXI API base URL (from your PAXI API documentation)</label><input value={api.baseUrl ?? ""} onChange={(e) => patch({ api: e.target.value ? { ...api, baseUrl: e.target.value } : undefined })} placeholder="https://…" /></div>
        )}
        <div><label>Customer tracking page (optional, use {"{ref}"} for the reference)</label><input value={(config.trackingUrlTemplate as string) ?? ""} onChange={(e) => patch({ trackingUrlTemplate: e.target.value || undefined })} /></div>
      </div>
    );
  }

  if (code === "COURIER_GUY") {
    const levels = (config.serviceLevels as Record<string, { name: string; kind?: string }> | undefined) ?? {};
    const entries = Object.entries(levels);
    const setLevels = (next: [string, { name: string; kind?: string }][]) => patch({ serviceLevels: Object.fromEntries(next.filter(([k]) => k.trim())) });
    return (
      <div className="card-flat stack">
        <strong className="small">Service names customers see</strong>
        <p className="small muted">Map The Courier Guy service codes to simple names (e.g. ECO → Economy, OVN → Fast). Unmapped services keep TCG&apos;s name. Same-day is shown only when TCG confirms delivery today.</p>
        {entries.map(([codeKey, v], i) => (
          <div key={i} className="row">
            <input aria-label="Service code" value={codeKey} style={{ width: 110 }} onChange={(e) => setLevels(entries.map((x, j) => (j === i ? [e.target.value.toUpperCase(), x[1]] : x)))} />
            <input aria-label="Customer name" value={v.name} style={{ flex: 1, minWidth: 140 }} onChange={(e) => setLevels(entries.map((x, j) => (j === i ? [x[0], { ...x[1], name: e.target.value }] : x)))} />
            <select aria-label="Type" value={v.kind ?? "DOOR"} style={{ width: 130 }} onChange={(e) => setLevels(entries.map((x, j) => (j === i ? [x[0], { ...x[1], kind: e.target.value }] : x)))}>
              <option value="DOOR">Door</option><option value="LOCKER">Locker</option><option value="KIOSK">Kiosk</option>
            </select>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => setLevels(entries.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <div><button type="button" className="btn btn-sm" onClick={() => setLevels([...entries, ["", { name: "" }]])}>+ Add service name</button></div>
        <div><label>Customer tracking page (optional, use {"{ref}"})</label><input value={(config.trackingUrlTemplate as string) ?? ""} onChange={(e) => patch({ trackingUrlTemplate: e.target.value || undefined })} /></div>
      </div>
    );
  }

  if (code.startsWith("LOCAL_COURIER")) {
    return (
      <div className="card-flat"><label>Courier API URL</label><input value={(config.baseUrl as string) ?? ""} onChange={(e) => patch({ baseUrl: e.target.value })} placeholder="https://…" /></div>
    );
  }

  if (code === "OWN_DELIVERY") {
    const sameDay = (config.sameDay as { enabled?: boolean; feeCents?: number; cutoffTime?: string } | undefined) ?? {};
    return (
      <div className="card-flat stack">
        <div className="grid-2">
          <div><label>Delivery fee (R)</label><input inputMode="decimal" defaultValue={centsToInput(config.feeCents as number)} onBlur={(e) => patch({ feeCents: toCents(e.target.value) ?? 0 })} /></div>
          <div><label>Deliver within (km of your address)</label><input type="number" min={1} value={(config.radiusKm as number) ?? ""} onChange={(e) => patch({ radiusKm: e.target.value ? Number(e.target.value) : undefined })} /></div>
          <div><label>Usual delivery time (working days)</label><input type="number" min={0} value={(config.standardDays as number) ?? 2} onChange={(e) => patch({ standardDays: Number(e.target.value) })} /></div>
        </div>
        <div><label>Or these suburbs/towns (comma separated)</label><input value={((config.serviceAreas as string[]) ?? []).join(", ")} onChange={(e) => patch({ serviceAreas: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} /></div>
        <label className="check"><input type="checkbox" checked={!!sameDay.enabled} onChange={(e) => patch({ sameDay: { feeCents: 0, cutoffTime: "13:00", ...sameDay, enabled: e.target.checked } })} /> I can deliver same-day</label>
        {sameDay.enabled && (
          <div className="grid-2">
            <div><label>Same-day fee (R)</label><input inputMode="decimal" defaultValue={centsToInput(sameDay.feeCents ?? 0)} onBlur={(e) => patch({ sameDay: { ...sameDay, feeCents: toCents(e.target.value) ?? 0 } })} /></div>
            <div><label>Order before (cut-off)</label><input type="time" value={sameDay.cutoffTime ?? "13:00"} onChange={(e) => patch({ sameDay: { ...sameDay, cutoffTime: e.target.value } })} /></div>
          </div>
        )}
      </div>
    );
  }

  if (code === "SELLER_COLLECTION") {
    return (
      <div className="card-flat stack">
        <div><label>Collection fee (R, usually 0)</label><input inputMode="decimal" defaultValue={centsToInput((config.feeCents as number) ?? 0)} onBlur={(e) => patch({ feeCents: toCents(e.target.value) ?? 0 })} /></div>
        <div><label>Collection instructions</label><textarea rows={2} value={(config.instructions as string) ?? ""} onChange={(e) => patch({ instructions: e.target.value || undefined })} placeholder="Mon–Fri 9:00–17:00. Ring the bell at the gate." /></div>
      </div>
    );
  }
  return null;
}
