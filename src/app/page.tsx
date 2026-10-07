import Link from "next/link";
import { redirect } from "next/navigation";
import { publicSiteUrl } from "./_lib/site";

export const dynamic = "force-dynamic";

export default function Home() {
  // On app.chatcart.co.za the marketing site lives elsewhere; this
  // address is for sellers signing in.
  if (publicSiteUrl()) redirect("/login");
  return (
    <main className="narrow stack">
      <h1>Chatcart</h1>
      <p className="muted">
        Sell on WhatsApp and online. Your customers choose how to receive their order: collect at PEP / PAXI,
        courier to their door, same-day delivery, or collect from you.
      </p>
      <div className="row">
        <Link className="btn btn-primary" href="/register">Open a shop</Link>
        <Link className="btn" href="/login">Seller login</Link>
      </div>
    </main>
  );
}
