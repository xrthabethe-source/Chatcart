// The public website (built separately, e.g. in Lovable) lives at
// PUBLIC_SITE_URL (https://chatcart.co.za); this app runs at
// APP_BASE_URL (https://app.chatcart.co.za). Policy pages are on the
// public site; checkout pages link to them because payment providers
// (Yoco, PayFast) check that shoppers can see them.
export function publicSiteUrl(): string | null {
  const url = process.env.PUBLIC_SITE_URL?.trim();
  return url ? url.replace(/\/$/, "") : null;
}

export const POLICY_PAGES = [
  { path: "/terms", label: "Terms" },
  { path: "/privacy", label: "Privacy" },
  { path: "/refunds", label: "Refunds & returns" },
  { path: "/delivery", label: "Delivery" },
  { path: "/contact", label: "Contact" },
] as const;
