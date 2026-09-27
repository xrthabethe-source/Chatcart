"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, toCents } from "../../_lib/format";

const int = (v: FormDataEntryValue | null) => (v && String(v).trim() ? Number(v) : null);

export function ProductForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(0);

  async function submit(form: FormData) {
    setError(null);
    const priceCents = toCents(String(form.get("price") ?? ""));
    if (priceCents === null) return setError("Enter a valid price.");
    try {
      await api("/api/v1/products", {
        method: "POST",
        json: {
          name: form.get("name"),
          sku: form.get("sku") || null,
          priceCents,
          weightGrams: int(form.get("weightGrams")),
          lengthCm: int(form.get("lengthCm")),
          widthCm: int(form.get("widthCm")),
          heightCm: int(form.get("heightCm")),
          shippingCategory: form.get("shippingCategory"),
        },
      });
      setKey((k) => k + 1);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <form key={key} className="card stack" action={submit}>
      <h2>Add a product</h2>
      {error && <div className="alert alert-error small" role="alert">{error}</div>}
      <div className="grid-2">
        <div><label htmlFor="p-name">Name</label><input id="p-name" name="name" required /></div>
        <div><label htmlFor="p-price">Price (R)</label><input id="p-price" name="price" inputMode="decimal" required placeholder="400" /></div>
        <div><label htmlFor="p-sku">SKU (optional)</label><input id="p-sku" name="sku" /></div>
        <div>
          <label htmlFor="p-cat">Shipping category</label>
          <select id="p-cat" name="shippingCategory" defaultValue="STANDARD">
            <option value="STANDARD">Standard</option><option value="FRAGILE">Fragile</option>
            <option value="PERISHABLE">Perishable</option><option value="OVERSIZED">Oversized</option>
          </select>
        </div>
      </div>
      <details>
        <summary className="small">Shipping size and weight (optional — otherwise your default parcel is used)</summary>
        <div className="grid-2" style={{ marginTop: 8 }}>
          <div><label htmlFor="p-w">Weight (g)</label><input id="p-w" name="weightGrams" type="number" min={1} /></div>
          <div><label htmlFor="p-l">Length (cm)</label><input id="p-l" name="lengthCm" type="number" min={1} /></div>
          <div><label htmlFor="p-wd">Width (cm)</label><input id="p-wd" name="widthCm" type="number" min={1} /></div>
          <div><label htmlFor="p-h">Height (cm)</label><input id="p-h" name="heightCm" type="number" min={1} /></div>
        </div>
      </details>
      <div><button className="btn btn-primary">Add product</button></div>
    </form>
  );
}
