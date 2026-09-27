"use client";
// Customer checkout. The customer mainly experiences: choose product →
// choose where to receive it → pay. Couriers, point codes and rate APIs
// stay behind the scenes.
import { useEffect, useMemo, useState } from "react";
import { api, rands } from "../../_lib/format";

type Method = "PAXI_PICKUP" | "DOOR_COURIER" | "SAME_DAY" | "SELLER_COLLECTION";

interface Product { id: string; name: string; description: string | null; priceCents: number }
interface MethodOption { method: Method; label: string }
interface Address { recipientName?: string | null; street: string; complex?: string | null; suburb: string; city: string; province?: string | null; postcode: string }
interface PickupPoint { id: string; name: string; suburb?: string | null; city?: string | null; address?: string | null; distanceLabel: string | null }
interface Suggestion { method: Method | null; pickupLocation: PickupPoint | null; address: (Address & { id: string }) | null }
interface ShopData {
  shop: { name: string; slug: string };
  products: Product[];
  deliveryMethods: MethodOption[];
  returning: { name: string | null; phone: string; suggestion: Suggestion | null } | null;
}
interface DeliveryOption { quoteId: string; method: Method; providerName: string; serviceName: string; priceCents: number; free: boolean; etaLabel: string | null }
interface QuoteResult { method: Method; options: DeliveryOption[]; alternatives: MethodOption[] }
interface CartView { subtotalCents: number; shippingCents: number | null; totalCents: number | null }

const ICON: Record<Method, string> = { PAXI_PICKUP: "🏪", DOOR_COURIER: "🚚", SAME_DAY: "⚡", SELLER_COLLECTION: "📦" };
const EMPTY_ADDRESS: Address = { street: "", suburb: "", city: "", postcode: "" };

export function Storefront({ slug }: { slug: string }) {
  const [data, setData] = useState<ShopData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [cartId, setCartId] = useState<string | null>(null);
  const [step, setStep] = useState<"products" | "delivery" | "pay">("products");
  const [error, setError] = useState<string | null>(null);

  // Delivery step state
  const [method, setMethod] = useState<Method | null>(null);
  const [offerReuse, setOfferReuse] = useState(true);
  const [query, setQuery] = useState("");
  const [points, setPoints] = useState<PickupPoint[] | null>(null);
  const [point, setPoint] = useState<PickupPoint | null>(null);
  const [address, setAddress] = useState<Address>(EMPTY_ADDRESS);
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [chosen, setChosen] = useState<DeliveryOption | null>(null);
  const [cart, setCart] = useState<CartView | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<ShopData>(`/api/v1/shop/${slug}`)
      .then((d) => {
        setData(d);
        if (d.returning?.suggestion?.address) setAddress(d.returning.suggestion.address);
      })
      .catch((e) => setLoadError((e as Error).message));
  }, [slug]);

  const items = useMemo(() => Object.entries(qty).filter(([, n]) => n > 0), [qty]);
  const subtotal = useMemo(() => items.reduce((sum, [id, n]) => sum + (data?.products.find((p) => p.id === id)?.priceCents ?? 0) * n, 0), [items, data]);

  if (loadError) return <main className="narrow"><div className="alert alert-error">{loadError}</div></main>;
  if (!data) return <main className="narrow"><p className="muted">Loading…</p></main>;

  const suggestion = data.returning?.suggestion ?? null;

  async function wrap<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  function resetDelivery() {
    setMethod(null);
    setPoints(null);
    setPoint(null);
    setQuote(null);
    setChosen(null);
    setCart(null);
  }

  async function startCheckout() {
    const res = await wrap(() =>
      api<{ cartId: string }>(`/api/v1/shop/${slug}/cart`, { method: "POST", json: { items: items.map(([productId, quantity]) => ({ productId, quantity })) } }),
    );
    if (!res) return;
    setCartId(res.cartId);
    resetDelivery();
    setStep("delivery");
  }

  async function getQuotes(body: Record<string, unknown>) {
    setChosen(null);
    setCart(null);
    const res = await wrap(() => api<QuoteResult>(`/api/v1/shop/${slug}/cart/${cartId}/quotes`, { method: "POST", json: body }));
    if (!res) return;
    setQuote(res);
    // One option (typical for PAXI and collection): choose it for them.
    if (res.options.length === 1) await choose(res.options[0]!);
  }

  async function choose(option: DeliveryOption) {
    const res = await wrap(() => api<{ cart: CartView }>(`/api/v1/shop/${slug}/cart/${cartId}/delivery`, { method: "PUT", json: { quoteId: option.quoteId } }));
    if (!res) return;
    setChosen(option);
    setCart(res.cart);
  }

  async function pickMethod(m: Method) {
    resetDelivery();
    setMethod(m);
    if (m === "SELLER_COLLECTION") await getQuotes({ method: m });
  }

  async function searchPoints(body: Record<string, unknown>) {
    setPoint(null);
    setQuote(null);
    const res = await wrap(() => api<{ points: PickupPoint[] }>(`/api/v1/shop/${slug}/pickup-points`, { method: "POST", json: body }));
    if (res) setPoints(res.points);
  }

  function useMyLocation() {
    if (!navigator.geolocation) return setError("Your browser can't share location. Search by suburb or town instead.");
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => searchPoints({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => {
        setBusy(false);
        setError("Location wasn't shared — no problem, search by suburb, town or postcode.");
      },
      { timeout: 10_000, maximumAge: 300_000 },
    );
  }

  async function selectPoint(p: PickupPoint) {
    setPoint(p);
    await getQuotes({ method: "PAXI_PICKUP", locationId: p.id });
  }

  async function reusePoint() {
    if (!suggestion?.pickupLocation) return;
    setMethod("PAXI_PICKUP");
    setOfferReuse(false);
    await selectPoint(suggestion.pickupLocation);
  }

  const cleanAddress = () => ({
    street: address.street, complex: address.complex || null, suburb: address.suburb, city: address.city,
    province: address.province || null, postcode: address.postcode, recipientName: address.recipientName || null,
  });

  // ── Render ────────────────────────────────────────────────────────

  return (
    <main className="narrow stack">
      <header>
        <h1>{data.shop.name}</h1>
        {data.returning?.name && <p className="muted">Welcome back, {data.returning.name.split(" ")[0]}!</p>}
      </header>
      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {step === "products" && (
        <section className="stack" aria-label="Products">
          {data.products.length === 0 && <p className="muted">No products yet.</p>}
          {data.products.map((p) => (
            <div key={p.id} className="card spread">
              <div>
                <div className="title"><strong>{p.name}</strong></div>
                {p.description && <div className="small muted">{p.description}</div>}
                <div className="price">{rands(p.priceCents)}</div>
              </div>
              <div className="row" aria-label={`Quantity of ${p.name}`}>
                <button className="btn btn-sm" aria-label="Fewer" onClick={() => setQty({ ...qty, [p.id]: Math.max(0, (qty[p.id] ?? 0) - 1) })}>−</button>
                <span style={{ minWidth: 24, textAlign: "center" }} aria-live="polite">{qty[p.id] ?? 0}</span>
                <button className="btn btn-sm" aria-label="More" onClick={() => setQty({ ...qty, [p.id]: (qty[p.id] ?? 0) + 1 })}>+</button>
              </div>
            </div>
          ))}
          <button className="btn btn-primary btn-block" disabled={items.length === 0 || busy} onClick={startCheckout}>
            {items.length === 0 ? "Add a product" : `Continue · ${rands(subtotal)}`}
          </button>
        </section>
      )}

      {step === "delivery" && (
        <section className="stack" aria-labelledby="delivery-h">
          <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setStep("products")}>← Change products</button>

          {offerReuse && suggestion?.pickupLocation && !method && data.deliveryMethods.some((m) => m.method === "PAXI_PICKUP") && (
            <div className="card stack">
              <p style={{ margin: 0 }}>You previously collected from <strong>{suggestion.pickupLocation.name}</strong>.</p>
              <p style={{ margin: 0 }}>Use this collection point again?</p>
              <div className="row">
                <button className="btn btn-primary" disabled={busy} onClick={reusePoint}>YES</button>
                <button className="btn" onClick={() => setOfferReuse(false)}>CHOOSE ANOTHER</button>
              </div>
            </div>
          )}

          <h2 id="delivery-h">How would you like to receive your order?</h2>
          <div>
            {data.deliveryMethods.map((m) => (
              <button key={m.method} className="choice" aria-pressed={method === m.method} onClick={() => pickMethod(m.method)} disabled={busy}>
                <span className="title">{ICON[m.method]} {m.label}</span>
              </button>
            ))}
            {data.deliveryMethods.length === 0 && <p className="muted">This shop hasn&apos;t set up delivery yet.</p>}
          </div>

          {method === "PAXI_PICKUP" && !point && (
            <div className="card stack">
              <h3>Where would you like to collect?</h3>
              <form className="row" onSubmit={(e) => { e.preventDefault(); if (query.trim().length >= 2) searchPoints({ text: query.trim() }); }}>
                <input aria-label="Suburb, town, postcode or store name" placeholder="Suburb, town, postcode or store name" value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
                <button className="btn" disabled={busy || query.trim().length < 2}>Search</button>
              </form>
              <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={useMyLocation} disabled={busy}>📍 Use my location</button>
              {points && points.length === 0 && <p className="muted small">No PAXI Points found. Try a nearby suburb, town or postcode.</p>}
              {points && points.length > 0 && (
                <div>
                  {points.map((p) => (
                    <button key={p.id} className="choice" onClick={() => selectPoint(p)} disabled={busy}>
                      <span>
                        <span className="title">{p.name}</span><br />
                        <span className="small muted">{p.distanceLabel ?? [p.suburb, p.city].filter(Boolean).join(", ")}</span>
                      </span>
                      <span className="select">SELECT</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {method === "PAXI_PICKUP" && point && (
            <div className="card-flat spread">
              <span>Collect at <strong>{point.name}</strong></span>
              <button className="btn btn-sm" onClick={() => { setPoint(null); setQuote(null); setChosen(null); setCart(null); }}>Change</button>
            </div>
          )}

          {(method === "DOOR_COURIER" || method === "SAME_DAY") && (
            <form className="card stack" onSubmit={(e) => { e.preventDefault(); getQuotes({ method, address: cleanAddress() }); }}>
              <h3>Delivery address</h3>
              {suggestion?.address && address.street === suggestion.address.street && <p className="small muted">Your last delivery address — change it if needed.</p>}
              <div><label htmlFor="a-street">Street address</label><input id="a-street" required value={address.street} onChange={(e) => setAddress({ ...address, street: e.target.value })} autoComplete="address-line1" /></div>
              <div><label htmlFor="a-complex">Complex / building (optional)</label><input id="a-complex" value={address.complex ?? ""} onChange={(e) => setAddress({ ...address, complex: e.target.value })} autoComplete="address-line2" /></div>
              <div className="grid-2">
                <div><label htmlFor="a-suburb">Suburb</label><input id="a-suburb" required value={address.suburb} onChange={(e) => setAddress({ ...address, suburb: e.target.value })} /></div>
                <div><label htmlFor="a-city">Town / city</label><input id="a-city" required value={address.city} onChange={(e) => setAddress({ ...address, city: e.target.value })} autoComplete="address-level2" /></div>
                <div><label htmlFor="a-postcode">Postcode</label><input id="a-postcode" required inputMode="numeric" pattern="\d{4}" maxLength={4} value={address.postcode} onChange={(e) => setAddress({ ...address, postcode: e.target.value })} autoComplete="postal-code" /></div>
              </div>
              <button className="btn btn-primary" disabled={busy}>{busy ? "Checking…" : method === "SAME_DAY" ? "Check same-day delivery" : "See delivery options"}</button>
            </form>
          )}

          {quote && quote.options.length > 1 && (
            <div className="card stack">
              <h3>Choose your delivery</h3>
              <div>
                {quote.options.map((o) => (
                  <button key={o.quoteId} className="choice" aria-pressed={chosen?.quoteId === o.quoteId} onClick={() => choose(o)} disabled={busy}>
                    <span>
                      <span className="title">{o.serviceName.toUpperCase()}</span><br />
                      <span className="small muted">{o.etaLabel}</span>
                    </span>
                    <span className="price">{o.free ? "FREE" : rands(o.priceCents)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {quote && quote.method === "SAME_DAY" && quote.options.length > 0 && chosen && (
            <div className="alert alert-ok">Good news 🎉 Same-day delivery is available. Delivery today {chosen.free ? "FREE" : rands(chosen.priceCents)}</div>
          )}
          {quote && quote.options.length === 0 && (
            <div className="card stack">
              {quote.method === "SAME_DAY" ? (
                <p style={{ margin: 0 }}>Same-day isn&apos;t available for this address.<br />You can choose:</p>
              ) : (
                <p style={{ margin: 0 }}>Sorry, this delivery option isn&apos;t available right now. You can choose:</p>
              )}
              <div className="row">
                {quote.alternatives.map((m) => (
                  <button key={m.method} className="btn" onClick={() => (m.method === "DOOR_COURIER" ? (setMethod("DOOR_COURIER"), getQuotes({ method: "DOOR_COURIER", address: cleanAddress() })) : pickMethod(m.method))}>
                    {m.method === "DOOR_COURIER" ? "Standard courier" : m.method === "PAXI_PICKUP" ? "PEP/PAXI collection" : m.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {chosen && quote && quote.options.length === 1 && method !== "SELLER_COLLECTION" && method !== "SAME_DAY" && (
            <div className="card-flat spread">
              <span>✓ {chosen.serviceName}{chosen.etaLabel ? ` · ${chosen.etaLabel}` : ""}</span>
              <span className="price">{chosen.free ? "FREE" : rands(chosen.priceCents)}</span>
            </div>
          )}
          {method === "SELLER_COLLECTION" && chosen && (
            <div className="card-flat">Collect from the seller · <strong>{chosen.free ? "Free" : rands(chosen.priceCents)}</strong> · {chosen.etaLabel}</div>
          )}

          {cart && chosen && (
            <button className="btn btn-primary btn-block" onClick={() => setStep("pay")}>Continue</button>
          )}
        </section>
      )}

      {step === "pay" && cart && chosen && (
        <PayStep
          slug={slug}
          cartId={cartId!}
          cart={cart}
          chosen={chosen}
          destination={method === "PAXI_PICKUP" ? point?.name ?? "" : method === "SELLER_COLLECTION" ? "Collect from the seller" : [address.street, address.suburb, address.city].join(", ")}
          defaults={{ name: data.returning?.name ?? address.recipientName ?? "", phone: data.returning?.phone ?? "" }}
          onBack={() => setStep("delivery")}
        />
      )}
    </main>
  );
}

function PayStep(props: {
  slug: string;
  cartId: string;
  cart: CartView;
  chosen: DeliveryOption;
  destination: string;
  defaults: { name: string; phone: string };
  onBack: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const label = props.chosen.method === "PAXI_PICKUP" ? "PAXI" : props.chosen.method === "SELLER_COLLECTION" ? "Collection" : "Delivery";

  async function submit(form: FormData) {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ paymentUrl: string }>(`/api/v1/shop/${props.slug}/cart/${props.cartId}/order`, {
        method: "POST",
        json: {
          customerName: form.get("name"),
          customerPhone: form.get("phone"),
          customerEmail: form.get("email") || null,
          rememberPreferences: form.get("remember") === "on",
        },
      });
      window.location.href = res.paymentUrl;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="stack" action={submit}>
      <button type="button" className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={props.onBack}>← Change delivery</button>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      <div className="card totals">
        <div className="small muted" style={{ display: "block" }}>{props.destination}</div>
        <div><span>Products</span><span className="price">{rands(props.cart.subtotalCents)}</span></div>
        <div><span>{label}</span><span className="price">{props.cart.shippingCents === 0 ? "FREE" : rands(props.cart.shippingCents!)}</span></div>
        <div className="total"><span>TOTAL</span><span>{rands(props.cart.totalCents!)}</span></div>
      </div>
      <div className="card stack">
        <div><label htmlFor="c-name">Your name</label><input id="c-name" name="name" required defaultValue={props.defaults.name} autoComplete="name" /></div>
        <div>
          <label htmlFor="c-phone">Cellphone (for WhatsApp updates)</label>
          <input id="c-phone" name="phone" required inputMode="tel" defaultValue={props.defaults.phone ? `0${props.defaults.phone.slice(2)}` : ""} placeholder="082 123 4567" autoComplete="tel" />
        </div>
        <div><label htmlFor="c-email">Email (optional)</label><input id="c-email" name="email" type="email" autoComplete="email" /></div>
        <label className="check"><input type="checkbox" name="remember" defaultChecked={!!props.defaults.phone} /> Remember my delivery choice on this device for next time</label>
      </div>
      <button className="btn btn-primary btn-block" disabled={busy}>{busy ? "Placing order…" : "PAY SECURELY"}</button>
    </form>
  );
}
