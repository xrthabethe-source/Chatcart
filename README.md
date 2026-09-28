# Chatcart

A multi-tenant, WhatsApp-first shop platform for South African sellers. Delivery is built around how customers here actually receive parcels:

1. **Collect at PEP / PAXI** (first-class and primary, not an add-on)
2. **Courier to my door** (The Courier Guy, or the seller's own delivery)
3. **Same-day delivery** (only when a courier confirms it)
4. **Collect from seller**

From the customer's side it's just: choose product → choose where to receive it → pay → get WhatsApp updates. Point codes, rate APIs, waybills and tracking stay behind the scenes.

Stack: Next.js 15 (App Router), Prisma 6 + PostgreSQL 16, zod, `node:test`.

## Onboarding an associate (about 5 minutes)

Built so a new associate (e.g. an APLGO distributor) can start selling the same day, without any Meta or developer setup.

1. **You** (platform admin) open **Admin**, create an invite link for them, and send it on WhatsApp.
2. **They** open it on their phone and go through four screens:
   - **You:** name, WhatsApp number, email and password (plus an optional associate ID).
   - **Products:** tick what they stock from the shared catalogue you loaded. Photos and prices are filled in.
   - **Delivery:** their address; PEP / PAXI (using your default PAXI prices) and "collect from me" are on by default.
   - **Payments:** paste their own Yoco secret key, or enter EFT / cash instructions.
3. They get their shop link and a ready-made message for their WhatsApp status.

How it works before their own number is connected to WhatsApp's API ("share-link mode"):

- **Chatting with the seller:** customers use "Chat with Sandile" (a wa.me link to the associate's own number).
- **After ordering:** customers can tap "Send your order to Sandile on WhatsApp".
- **Order and delivery updates:** these come from the shared Chatcart number (`WHATSAPP_PLATFORM_PHONE_ID`), with the shop's name in every message. The associate gets a WhatsApp alert for each paid order.

**Payments.** Card payments go through **the associate's own Yoco account**, so money goes straight to them and Chatcart never holds funds. When an associate connects Yoco, Chatcart registers a webhook on their Yoco account. Orders are marked paid only by a correctly signed `payment.succeeded` event for the exact order amount. The Yoco client (`src/server/payments/yoco.ts`) follows Yoco's published Checkout API and is tested against recorded responses. **Check it once with a test key (`sk_test_…`) before going live.**

**Before inviting associates**, as platform admin (your email in `PLATFORM_ADMIN_EMAILS`):
1. Load the product catalogue: **Admin → Product catalogue**, uploading a CSV with columns `sku, name, price` plus optional `description, image_url, category, weight_g, length_cm, width_cm, height_cm`. Re-uploading updates names, photos and sizes in every shop, but never associates' own prices. The seed script's `SAMPLE-*` products are placeholders.
2. Set **Admin → Default PEP / PAXI prices**.
3. Check the brand's distributor policy on online selling.

## Delivery architecture

```
checkout / WhatsApp flow / seller dashboard / tracking cron
                     │  (services only — no courier-specific code)
                     ▼
        DeliveryProvider interface  (src/server/delivery/types.ts)
   ┌──────────┬──────────────┬───────────────┬──────────────┬──────────────────┐
   PAXI       CourierGuy     LocalCourier    OwnDelivery    SellerCollection
```

`DeliveryProvider` has `getLocations`, `searchLocations`, `getRates`, `createShipment`, `cancelShipment`, `getTracking`, `getTrackingUrl`, `supportsPickupPoints`, `supportsDoorDelivery`, `supportsSameDay` (plus `supportsAssistedMode` and `parseConfig`). Adapters don't touch the database. They take a `ProviderContext` (mode, decrypted credentials, config, an injectable `fetch`) and return plain data, so each one is unit-tested against recorded responses.

**Adding a courier** means writing an adapter in `src/server/delivery/providers/`, adding one line to `registry.ts` and one row in `delivery_providers`. Orders, carts and checkout don't change. A same-day courier that speaks the documented [local-courier contract](src/server/delivery/providers/local-courier.ts) needs no code at all: a platform admin registers it with `POST /api/v1/admin/delivery-providers` `{ "code": "LOCAL_COURIER_<NAME>", "name": "…" }`.

### Data model

| Table | Holds |
|---|---|
| `delivery_providers` | Platform courier catalogue and capabilities |
| `tenant_delivery_providers` | Per-seller settings: enabled, which methods it serves, mode, encrypted credentials, pricing, dispatch address, default parcel, handling time, adapter `config` |
| `delivery_locations` | Pickup-point directory: provider, `location_id`, `location_code`, name, address, suburb, city, province, postcode, lat/lng |
| `delivery_quotes` | Every priced option shown to a customer (courier rate vs customer price, ETA, destination snapshot) |
| `shipments` | Provider-specific data: mode, status, tracking number, waybill ref, label, parcel, `provider_data` |
| `shipment_events` | Deduplicated tracking history (`dedupe_key` is unique per shipment) |
| `outbound_messages` | WhatsApp notification outbox, deduplicated per event |

`orders` hold only generic delivery fields: `delivery_method`, `delivery_provider_id`, `delivery_service_code`, `delivery_location_id`, `shipping_cents`, plus a frozen `delivery_destination` snapshot. Re-syncing the PAXI directory or editing a saved address never changes a placed order. Database `CHECK` constraints make negative amounts, or a total that isn't subtotal + shipping, impossible to store.

## PEP / PAXI: two modes, same customer experience

- **Integrated.** PAXI API credentials are configured. Point discovery, rates, shipment creation and tracking all go to the API.
- **Assisted / manual dispatch.** For launching before PAXI grants API access, which needs commercial approval and parcel volume:
  - Customers still search and select a PAXI Point, from `delivery_locations`.
  - Prices come from the seller's PAXI tariff in settings. With no tariff, PAXI isn't offered rather than showing a made-up price.
  - When paid, the shipment lands in **Orders → Ready for PAXI registration**. The seller exports a CSV or uses *Copy shipping details* to register the parcel on the PAXI portal, then enters the PAXI reference. That links it to the order and messages the customer.
  - The seller then updates progress (ready for collection, collected), and each update also messages the customer.

Customers search by suburb, town, postcode or store name, or tap **Use my location** (optional, never required). Results show as *PEP Jabulani Mall · 1.2 km away · SELECT*, ordered by distance in SQL.

> **Before going live with PAXI:**
> - **Assisted mode:** load the real PAXI Point directory with `POST /api/v1/admin/delivery-locations/import` (platform admins are listed in `PLATFORM_ADMIN_EMAILS`). The seed script's points are `DEMO-*` samples, not PAXI data.
> - **Integrated mode:** PAXI's API spec is issued with account approval, so the endpoint paths are configurable (`config.api`) and responses go through tolerant mappers in `providers/paxi.ts`. Check them against the issued spec; that's the only file to change.

## The Courier Guy

This uses the ShipLogic v2 API behind TCG business accounts: `/v2/rates`, `/v2/shipments`, `/v2/shipments/label`, `/v2/shipments/cancel` and `/v2/tracking/shipments`, with a Bearer API key.

- Sellers map TCG service codes to simple names ("ECO → Economy", "OVN → Fast"), so customers see *ECONOMY R89.50 · 2-4 working days*.
- Unavailable services are never shown.
- A service counts as **same-day only when TCG's own `delivery_date_to` is today (SAST)**.

> **Verify against your TCG account:** field names were written from ShipLogic's public API shape and tested against recorded fixtures, not a live account. Locker/kiosk service levels are recognised and kept out of door delivery, but choosing a TCG locker at checkout isn't built yet.

## Same-day

"Same-day delivery" is its own customer option. It queries every enabled provider serving `SAME_DAY`:

- TCG
- local couriers, which must answer `available: true` with a delivery time today
- the seller's own delivery, only inside their radius or suburb list and before their cut-off

If none confirm, the customer sees *"Same-day isn't available for this address. You can choose: Standard courier / PEP/PAXI collection"*, and the address they typed is reused.

## Seller delivery settings

These are per provider:

- Enabled on/off, and which methods it serves.
- Assisted or integrated mode.
- API key: AES-256-GCM encrypted under `DELIVERY_CREDENTIALS_KEY` and never returned to the browser.
- Pricing: **exact courier rate** *or* **courier rate + handling (fee and/or % markup)**, plus optional **free delivery over R___**. Ambiguous combinations are rejected, such as a handling fee on "exact rate".
- Dispatch/pickup address, default parcel size and weight, handling time.
- Provider-specific extras: PAXI tariff, TCG service names, own-delivery radius and cut-off, collection instructions.

**Parcel size.** Products can carry weight, length, width, height and a shipping category. Fully dimensioned carts are stacked (largest footprint, summed height and weight). Anything else uses the seller's default parcel. Replacing `calculateParcel` later changes nothing else.

## WhatsApp

`src/server/services/whatsapp-flow.ts` drives the same checkout services as the web:

```
Customer: I want 2 Product A
Shop:     Added ✓ 2 × Product A
          How would you like to receive your order?
          1. 🏪 Collect at PEP  2. 🚚 Deliver to my door  3. ⚡ Same-day  4. 📦 Collect from Sandile
Customer: 1
Shop:     Where would you like to collect? … or share your location 📍
Customer: Tembisa
Shop:     Nearby PAXI Points: 1. PEP Tembisa Mall — 1.2 km away …
Customer: 1
Shop:     Products R800 / PAXI R59.95 / TOTAL R859.95 → PAY SECURELY
```

- **Returning customers:** *"Last time you collected at: PEP Jabulani Mall. Use it again? YES / CHOOSE ANOTHER"*. Repeat checkout takes two taps.
- **`TRACK`** replies with the order number, courier, PAXI destination, status, expected date and tracking number. It only shows what the provider has confirmed.
- **`FORGET`** clears remembered delivery details.

**Notifications:** order paid, booked, collected, in transit, ready for PAXI collection, out for delivery, delivered, delivery problem. They go through a deduplicated outbox, so re-polled tracking never double-messages. Inside the 24-hour customer-service window they're sent as text. Outside it they need an approved template. The exact template texts are in [docs/whatsapp-templates.md](docs/whatsapp-templates.md), generated from the code, and customers get the same wording either way. **Get these approved in WhatsApp Manager before going live.**

**Consent (POPIA):**
- Web customers are remembered only if they tick "Remember my delivery choice on this device". That is tied to an httpOnly device cookie, so typing someone's phone number never reveals their addresses.
- On WhatsApp, where the number is verified by the channel, the order confirmation says details are remembered and that `FORGET` stops it.

## Seller order dashboard

**Orders list** has tabs: Awaiting payment · Ready to book · Ready for PAXI registration (with CSV export) · On the way · Problems · Completed.

**Order page:**
- Customer, products and payment.
- Delivery method and destination. PAXI orders show a prominent PAXI banner with store and point code; door orders show the full address.
- Courier, tracking number and tracking history.

Actions, where the provider supports them:
- **Book delivery**
- **Enter PAXI reference**
- **Print label**
- **Copy shipping details**
- **Track parcel**
- **Courier tracking page**
- **Update progress** (assisted and own delivery only, limited to statuses that make sense for the destination)
- **Cancel**
- **Message customer** (opens wa.me)

## Setup

```bash
createuser shop_dev --createdb && psql -d postgres -c "ALTER ROLE shop_dev WITH PASSWORD 'shop_dev';"
createdb -O shop_dev chatcart_dev && createdb -O shop_dev chatcart_test
cp .env.example .env            # set DELIVERY_CREDENTIALS_KEY=$(openssl rand -base64 32)
npm install && npm run db:generate
npm run db:migrate:deploy        # repeat with DATABASE_URL pointing at chatcart_test
node --env-file=.env --experimental-strip-types prisma/seed.ts   # demo shop at /shop/demo
npm run dev
npm run test:local && npm run typecheck && npm run lint
```

**Cron:** every 15–30 minutes, `POST /api/v1/delivery/tracking/sync` with `Authorization: Bearer $CRON_SECRET`. It refreshes courier tracking and flushes the WhatsApp outbox.

**Deploying and connecting WhatsApp:** follow [docs/deploy.md](docs/deploy.md). It covers Railway (`railway.json` for the web app, `railway.cron.json` for the 15-minute tracking job), Meta app setup, linking the number under **Shop settings**, and the message templates in [docs/whatsapp-templates.md](docs/whatsapp-templates.md). After editing a template's wording in `src/server/delivery/messages.ts`, regenerate that doc with `node --experimental-strip-types scripts/generate-template-doc.ts`. A test fails if the two drift apart.

## Not built yet

- **Payments.** `markOrderPaid` is the integration point. Sellers can mark EFT/cash payments by hand, and in `APP_ENV=development` `/pay/<id>` can simulate a payment. No gateway (PayFast, Yoco, Ozow…) is connected.
- **Courier webhooks.** Tracking is polled by the cron job; push webhooks aren't handled.
- **Packing and sizing.** Multi-parcel shipments, real bin-packing, and weight limits per shipping category.
- **Security.** No rate limiting on the public storefront APIs. Tenant isolation is enforced in the service layer (and tested) but there is no Postgres row-level security yet.
