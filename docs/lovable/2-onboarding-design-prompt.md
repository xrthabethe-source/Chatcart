# Lovable prompt 2: onboarding screen designs (to port into Chatcart)

This asks Lovable for a **clickable design prototype only**, with fake data and no backend. The real onboarding stays in Chatcart (it handles accounts, the catalogue, Yoco and WhatsApp). When you like the result, share it with Claude in one of two ways:

- **Best:** in Lovable, connect the project to GitHub (Project → GitHub → Connect). Then add that repository to your Claude session and say "port the Lovable onboarding design into Chatcart".
- **Or:** take a screenshot of each screen and send them.

The fields, steps and messages below match what Chatcart already does, so the design can be ported without changing how anything works.

---

Build a **clickable mobile prototype** (no backend, no real API calls, fake data in memory) of the **seller onboarding flow** for **Chatcart**. Chatcart is a South African platform where independent direct-selling associates open an online shop and take orders on WhatsApp. An associate receives an invite link on WhatsApp, opens it on their phone, and should be selling in about **5 minutes**.

Design for **phone screens 360–420px wide** first (it should still look fine on desktop). Users are often first-time online sellers: keep it calm, encouraging and obvious, with big tap targets, one main action per screen, and no jargon.

## Brand
- Primary green **#0f7b5f**; PEP/PAXI accent red **#c8102e**, used only for PEP/PAXI; off-white background **#f7f6f3**; white cards; dark mode supported.
- Friendly rounded shapes. Do not use any real brand logos (PEP, PAXI, Yoco, WhatsApp, Facebook); use text and simple icons instead.

## Flow and screens

A **progress bar** with five labelled steps is visible on steps 1–5: **You · Products · Delivery · Payments · Share**.

### 0. Invite landing (before step 1)
- Heading: "Welcome, Sandile!" (the invitee's first name comes from the invite).
- Subtext: "About 5 minutes. You'll get a shop link to share on WhatsApp."
- Expired-link state: "This link has expired. Invite links work once and expire after a while. Ask the person who invited you for a new one." Also a "Log in" link.

### 1. You (account)
Fields, in this order:
- **Your name** (required)
- **Your WhatsApp number** (required, SA format, e.g. "082 123 4567"). Help text: "Customers chat to you here, and we'll send your new orders to it."
- **Shop name** (optional). The placeholder is "<First name>'s Shop".
- **APLGO associate ID** (optional)
- **Email (to log in)** (required)
- **Password** (required, at least 8 characters)

Button: **Create my shop** (loading state: "Creating your shop…").

Error examples:
- "Enter a valid cellphone number, e.g. 082 123 4567."
- "An account with this email already exists — log in instead."

### 2. Products: "What do you sell?"
- Subtext: "Tick the products you keep in stock. Photos and prices are filled in for you; you can change your prices later."
- A **2-column grid of product cards**, each with a photo, name, price (e.g. "R850") and a checkbox. Selected cards get a green border and tint.
- "4 of 12 selected" counter, plus a **Select all / Clear all** button.
- Button: **Continue**, or **Skip for now** when nothing is selected.
- Empty state: "The product catalogue hasn't been loaded yet. You can skip this and add products later."

### 3. Delivery: "How will customers get their order?"
- Subtext: "You can add couriers and same-day delivery later."
- Two toggles, both on by default:
  - **🏪 Collect at PEP / PAXI**: "Customers pick their nearest PEP store (from R59.95). You drop parcels at any PEP." Disabled state: "Coming soon: PAXI prices haven't been set up yet."
  - **📦 Collect from me**: "Free. Customers collect at your address."
- **Your address** card: "Where you send parcels from, and where customers collect. It's only shown to customers who choose to collect from you." Fields: Street address, Suburb, Town / city, Postcode (4 digits).
- Error: "Choose at least one way for customers to get their order."
- Button: **Continue**.

### 4. Payments: "How will customers pay?"
- Subtext: "Money goes straight to you. Chatcart never holds your money."
- Two big choice buttons: **💳 Card (Yoco)** and **🏦 EFT / cash**.
- **Yoco panel:**
  - Instructions: "Log in to your Yoco account, find Online payments / API keys, and copy your secret key. It starts with sk_live_."
  - Field: **Yoco secret key**.
  - Note: "Stored encrypted and never shown again. No Yoco account yet? Choose EFT / cash for now."
  - Button: **Connect Yoco**. Error: "That doesn't look like a Yoco secret key. It starts with sk_live_ (or sk_test_ for testing)."
- **EFT panel:**
  - Text area: "What customers should do", with the placeholder "EFT to: FNB 62xxxxxxx (S Mokoena) / Use your order number as reference. / Or pay cash when you collect."
  - Note: "Shown after they order. When the money arrives, tap “Mark as paid” on the order."
  - Button: **Save**.
- Connected state: "✓ Yoco is connected. Card payments go straight into your Yoco account."

### 5. Share: "🎉 Your shop is live!"
- Subtext: "Share it on your WhatsApp status and with your customers."
- Card with:
  - The shop link (e.g. app.chatcart.co.za/shop/sandiles-shop)
  - **Share on WhatsApp** (primary)
  - **Copy message for my WhatsApp status**, which changes to "Copied ✓"
  - A preview of the message: "🛍️ You can now order from me online. You can collect at your nearest PEP store, or collect from me. Pay securely by card. app.chatcart.co.za/shop/sandiles-shop"
- Optional card: "📲 Optional: use your own WhatsApp number. Order updates come from the Chatcart number for now. Connect your WhatsApp Business number any time (about 5 minutes)." Button: **Connect my WhatsApp**.
- Button: **Go to my orders**.

## Also design
- **Loading and error states** for every button, and inline field errors.
- A **"Finish setting up your shop"** card for the top of the seller's orders page. It lists what's still to do ("choose your products, set up payments") with a **Continue setup** button. Once setup is complete, it becomes a **Your shop link** card with Share / Copy buttons.

## Constraints
- This is a design prototype: keep all data fake and in memory, with no auth, database or external calls.
- Keep the step order, fields and messages exactly as above (wording polish is fine). They map to an existing backend.
- Accessible: real labels on inputs, visible focus, good contrast, works with a screen reader.
