import Link from "next/link";
import { requireCurrentUser } from "@/server/http/context";
import { listProducts } from "@/server/services/products";
import { rands } from "../../_lib/format";
import { ProductForm } from "./product-form";

export default async function ProductsPage() {
  const user = await requireCurrentUser();
  const products = await listProducts(user);
  return (
    <main className="container stack">
      <div className="spread">
        <h1>Products</h1>
        <Link className="btn" href="/dashboard/setup">Choose from the catalogue</Link>
      </div>
      <ProductForm />
      <div className="card table-wrap">
        {products.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>No products yet.</p>
        ) : (
          <table>
            <thead><tr><th>Product</th><th>Shipping</th><th className="num">Price</th></tr></thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.name}</strong>{p.sku && <div className="small muted">{p.sku}</div>}{!p.active && <span className="chip">Hidden</span>}</td>
                  <td className="small">
                    {p.weightGrams ? `${p.weightGrams} g` : "No weight"} ·{" "}
                    {p.lengthCm && p.widthCm && p.heightCm ? `${p.lengthCm}×${p.widthCm}×${p.heightCm} cm` : "default parcel"}
                    {p.shippingCategory !== "STANDARD" && <> · <span className="chip chip-warn">{p.shippingCategory.toLowerCase()}</span></>}
                  </td>
                  <td className="num">{rands(p.priceCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
