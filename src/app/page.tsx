import Link from "next/link";

export default function Home() {
  return (
    <main className="narrow stack">
      <h1>HealthSweets Shop</h1>
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
