"use client";
// Associate onboarding: account → products → delivery → payments → share.
// Used by the invite link (/join/<token>, starting at "account") and by
// the dashboard's "Finish setting up" page (starting at "products").
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, rands } from "../_lib/format";

type Step = "account" | "products" | "delivery" | "payments" | "done";
const STEPS: Step[] = ["account", "products", "delivery", "payments", "done"];
const STEP_LABEL: Record<Step, string> = { account: "You", products: "Products", delivery: "Delivery", payments: "Payments", done: "Share" };

interface CatalogueItem {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  category: string | null;
  recommendedPriceCents: number;
  selected: boolean;
}

interface Status {
  shopName: string;
  shopUrl: string;
  shareText: string;
  whatsappShareUrl: string;
  steps: { products: boolean; delivery: boolean; payments: boolean };
  yocoConnected: boolean;
  paxiAvailable: boolean;
  paxiFromCents: number | null;
}

export function SetupWizard({ token, invitedName, startAt }: { token?: string; invitedName?: string | null; startAt: Step }) {
  const [step, setStep] = useState<Step>(startAt);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const visible = STEPS.filter((s) => token || s !== "account");

  useEffect(() => {
    if (step !== "account") api<{ status: Status }>("/api/v1/onboarding").then((r) => setStatus(r.status)).catch(() => undefined);
  }, [step]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const next = () => setStep(STEPS[STEPS.indexOf(step) + 1]!);

  return (
    <main className="narrow stack">
      <ol className="progress" aria-label="Setup progress">
        {visible.map((s) => (
          <li key={s} aria-current={s === step ? "step" : undefined} data-done={visible.indexOf(s) < visible.indexOf(step)}>
            {STEP_LABEL[s]}
          </li>
        ))}
      </ol>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {step === "account" && token && <AccountStep token={token} invitedName={invitedName ?? null} busy={busy} run={run} onDone={next} />}
      {step === "products" && <ProductsStep busy={busy} run={run} onDone={next} />}
      {step === "delivery" && <DeliveryStep status={status} busy={busy} run={run} onDone={next} />}
      {step === "payments" && <PaymentsStep status={status} busy={busy} run={run} onDone={next} />}
      {step === "done" && <DoneStep status={status} />}
    </main>
  );
}

type RunFn = (fn: () => Promise<void>) => Promise<void>;

function AccountStep({ token, invitedName, busy, run, onDone }: { token: string; invitedName: string | null; busy: boolean; run: RunFn; onDone: () => void }) {
  const [name, setName] = useState(invitedName ?? "");
  const first = name.trim().split(" ")[0];
  return (
    <form
      className="card stack"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run(async () => {
          await api(`/api/v1/join/${token}`, {
            method: "POST",
            json: {
              name: f.get("name"),
              shopName: String(f.get("shopName") ?? "").trim() || undefined,
              whatsappNumber: f.get("whatsapp"),
              email: f.get("email"),
              password: f.get("password"),
              associateId: String(f.get("associateId") ?? "").trim() || null,
            },
          });
          onDone();
        });
      }}
    >
      <div>
        <h1>{invitedName ? `Welcome, ${invitedName}!` : "Open your shop"}</h1>
        <p className="muted">About 5 minutes. You&apos;ll get a shop link to share on WhatsApp.</p>
      </div>
      <div><label htmlFor="j-name">Your name</label><input id="j-name" name="name" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div>
        <label htmlFor="j-wa">Your WhatsApp number</label>
        <input id="j-wa" name="whatsapp" required inputMode="tel" autoComplete="tel" placeholder="082 123 4567" />
        <p className="small muted">Customers chat to you here, and we&apos;ll send your new orders to it.</p>
      </div>
      <div><label htmlFor="j-shop">Shop name</label><input id="j-shop" name="shopName" placeholder={first ? `${first}'s Shop` : "e.g. Sandile's Shop"} /></div>
      <div><label htmlFor="j-assoc">APLGO associate ID (optional)</label><input id="j-assoc" name="associateId" /></div>
      <div><label htmlFor="j-email">Email (to log in)</label><input id="j-email" name="email" type="email" required autoComplete="email" /></div>
      <div><label htmlFor="j-pass">Password</label><input id="j-pass" name="password" type="password" required minLength={8} autoComplete="new-password" /></div>
      <button className="btn btn-primary btn-block" disabled={busy}>{busy ? "Creating your shop…" : "Create my shop"}</button>
    </form>
  );
}

function ProductsStep({ busy, run, onDone }: { busy: boolean; run: RunFn; onDone: () => void }) {
  const [items, setItems] = useState<CatalogueItem[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => {
    api<{ products: CatalogueItem[] }>("/api/v1/catalogue").then((r) => {
      setItems(r.products);
      setPicked(new Set(r.products.filter((p) => p.selected).map((p) => p.id)));
    });
  }, []);
  if (!items) return <p className="muted">Loading products…</p>;

  const toggle = (id: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return (
    <section className="stack">
      <div>
        <h1>What do you sell?</h1>
        <p className="muted">Tick the products you keep in stock. Photos and prices are filled in for you; you can change your prices later.</p>
      </div>
      {items.length === 0 ? (
        <div className="alert alert-warn">The product catalogue hasn&apos;t been loaded yet. You can skip this and add products later.</div>
      ) : (
        <>
          <div className="spread">
            <span className="small muted">{picked.size} of {items.length} selected</span>
            <button type="button" className="btn btn-sm" onClick={() => setPicked(picked.size === items.length ? new Set() : new Set(items.map((i) => i.id)))}>
              {picked.size === items.length ? "Clear all" : "Select all"}
            </button>
          </div>
          <div className="pick-grid">
            {items.map((p) => (
              <label key={p.id} className="pick" data-checked={picked.has(p.id)}>
                <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imageUrl} alt="" loading="lazy" />
                ) : (
                  <span className="pick-noimg" aria-hidden="true">{p.name.slice(0, 2).toUpperCase()}</span>
                )}
                <span className="pick-name">{p.name}</span>
                <span className="price small">{rands(p.recommendedPriceCents)}</span>
              </label>
            ))}
          </div>
        </>
      )}
      <button
        className="btn btn-primary btn-block"
        disabled={busy}
        onClick={() => run(async () => {
          if (items.length) await api("/api/v1/catalogue", { method: "PUT", json: { masterProductIds: [...picked] } });
          onDone();
        })}
      >
        {items.length && picked.size === 0 ? "Skip for now" : "Continue"}
      </button>
    </section>
  );
}

function DeliveryStep({ status, busy, run, onDone }: { status: Status | null; busy: boolean; run: RunFn; onDone: () => void }) {
  const [paxi, setPaxi] = useState(true);
  const [collection, setCollection] = useState(true);
  const paxiAvailable = status?.paxiAvailable ?? false;
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run(async () => {
          await api("/api/v1/onboarding/delivery", {
            method: "POST",
            json: {
              street: f.get("street"),
              suburb: f.get("suburb"),
              city: f.get("city"),
              postcode: f.get("postcode"),
              paxi: paxiAvailable && paxi,
              collection,
            },
          });
          onDone();
        });
      }}
    >
      <div>
        <h1>How will customers get their order?</h1>
        <p className="muted">You can add couriers and same-day delivery later in Delivery settings.</p>
      </div>
      <div className="card stack">
        <label className="check">
          <input type="checkbox" checked={paxiAvailable && paxi} disabled={!paxiAvailable} onChange={(e) => setPaxi(e.target.checked)} />
          <span>
            <strong>🏪 Collect at PEP / PAXI</strong><br />
            <span className="small muted">
              {paxiAvailable
                ? `Customers pick their nearest PEP store${status?.paxiFromCents ? ` (from ${rands(status.paxiFromCents)})` : ""}. You drop parcels at any PEP.`
                : "Coming soon: PAXI prices haven't been set up yet."}
            </span>
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={collection} onChange={(e) => setCollection(e.target.checked)} />
          <span><strong>📦 Collect from me</strong><br /><span className="small muted">Free. Customers collect at your address.</span></span>
        </label>
      </div>
      <div className="card stack">
        <h2>Your address</h2>
        <p className="small muted">Where you send parcels from, and where customers collect. It&apos;s only shown to customers who choose to collect from you.</p>
        <div><label htmlFor="d-street">Street address</label><input id="d-street" name="street" required autoComplete="address-line1" /></div>
        <div className="grid-2">
          <div><label htmlFor="d-suburb">Suburb</label><input id="d-suburb" name="suburb" required /></div>
          <div><label htmlFor="d-city">Town / city</label><input id="d-city" name="city" required autoComplete="address-level2" /></div>
          <div><label htmlFor="d-postcode">Postcode</label><input id="d-postcode" name="postcode" required inputMode="numeric" pattern="\d{4}" maxLength={4} autoComplete="postal-code" /></div>
        </div>
      </div>
      <button className="btn btn-primary btn-block" disabled={busy}>{busy ? "Saving…" : "Continue"}</button>
    </form>
  );
}

function PaymentsStep({ status, busy, run, onDone }: { status: Status | null; busy: boolean; run: RunFn; onDone: () => void }) {
  const [mode, setMode] = useState<"yoco" | "eft">("yoco");
  if (status?.yocoConnected) {
    return (
      <section className="stack">
        <h1>Payments</h1>
        <div className="alert alert-ok">✓ Yoco is connected. Card payments go straight into your Yoco account.</div>
        <button className="btn btn-primary btn-block" onClick={onDone}>Continue</button>
      </section>
    );
  }
  return (
    <section className="stack">
      <div>
        <h1>How will customers pay?</h1>
        <p className="muted">Money goes straight to you. Chatcart never holds your money.</p>
      </div>
      <div className="row">
        <button type="button" className="choice" aria-pressed={mode === "yoco"} onClick={() => setMode("yoco")} style={{ flex: 1 }}><span className="title">💳 Card (Yoco)</span></button>
        <button type="button" className="choice" aria-pressed={mode === "eft"} onClick={() => setMode("eft")} style={{ flex: 1, marginTop: 0 }}><span className="title">🏦 EFT / cash</span></button>
      </div>
      {mode === "yoco" ? (
        <form
          className="card stack"
          onSubmit={(e) => {
            e.preventDefault();
            const key = String(new FormData(e.currentTarget).get("key") ?? "");
            run(async () => {
              await api("/api/v1/payments/yoco", { method: "POST", json: { secretKey: key } });
              onDone();
            });
          }}
        >
          <p className="small">
            Log in to your Yoco account (the Yoco app or portal), find <strong>Online payments / API keys</strong>, and copy your
            <strong> secret key</strong>. It starts with <span className="mono">sk_live_</span>.
          </p>
          <div><label htmlFor="p-key">Yoco secret key</label><input id="p-key" name="key" required autoComplete="off" spellCheck={false} placeholder="sk_live_…" /></div>
          <p className="small muted">Stored encrypted and never shown again. No Yoco account yet? Choose EFT / cash for now.</p>
          <button className="btn btn-primary btn-block" disabled={busy}>{busy ? "Connecting…" : "Connect Yoco"}</button>
        </form>
      ) : (
        <form
          className="card stack"
          onSubmit={(e) => {
            e.preventDefault();
            const text = String(new FormData(e.currentTarget).get("instructions") ?? "");
            run(async () => {
              await api("/api/v1/payments", { method: "PATCH", json: { paymentInstructions: text } });
              onDone();
            });
          }}
        >
          <div>
            <label htmlFor="p-eft">What customers should do</label>
            <textarea id="p-eft" name="instructions" rows={4} required placeholder={"EFT to: FNB 62xxxxxxx (S Mokoena)\nUse your order number as reference.\nOr pay cash when you collect."} />
          </div>
          <p className="small muted">Shown after they order. When the money arrives, tap “Mark as paid” on the order.</p>
          <button className="btn btn-primary btn-block" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </form>
      )}
    </section>
  );
}

function DoneStep({ status }: { status: Status | null }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  if (!status) return <p className="muted">Loading…</p>;
  return (
    <section className="stack">
      <div>
        <h1>🎉 Your shop is live!</h1>
        <p className="muted">Share it on your WhatsApp status and with your customers.</p>
      </div>
      <div className="card stack">
        <div className="mono" style={{ wordBreak: "break-all" }}>{status.shopUrl}</div>
        <a className="btn btn-primary btn-block" href={status.whatsappShareUrl} target="_blank" rel="noreferrer">Share on WhatsApp</a>
        <button
          className="btn btn-block"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(status.shareText);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied ✓" : "Copy message for my WhatsApp status"}
        </button>
        <pre className="copy">{status.shareText}</pre>
      </div>
      {!status.steps.products && <div className="alert alert-warn small">You haven&apos;t chosen any products yet. Add them from Products in your dashboard.</div>}
      <button className="btn btn-block" onClick={() => { router.push("/dashboard/orders"); router.refresh(); }}>Go to my orders</button>
    </section>
  );
}
