import { POLICY_PAGES, publicSiteUrl } from "./site";

/**
 * Footer for customer-facing pages. `seller` names who the customer is
 * actually buying from: each shop is an independent seller, and
 * Chatcart is the platform.
 */
export function SiteFooter({ seller }: { seller?: { shopName: string; whatsappNumber: string | null; cardPayments?: boolean } }) {
  const site = publicSiteUrl();
  return (
    <footer className="site-footer">
      {seller && (
        <p>
          Sold by <strong>{seller.shopName}</strong>, an independent seller using Chatcart.
          {seller.whatsappNumber && <> Contact the seller on WhatsApp: <span className="mono">0{seller.whatsappNumber.slice(2)}</span>.</>}
        </p>
      )}
      {site && (
        <nav aria-label="Policies">
          {POLICY_PAGES.map((p) => (
            <a key={p.path} href={`${site}${p.path}`}>{p.label}</a>
          ))}
        </nav>
      )}
      <p>
        Secure ordering by {site ? <a href={site}>Chatcart</a> : "Chatcart"}.
        {seller?.cardPayments && " Card payments are processed by Yoco; card details never reach this site."}
      </p>
    </footer>
  );
}
