"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "../_lib/format";

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(form: FormData) {
    setBusy(true);
    setError(null);
    try {
      await api("/api/v1/auth/register", {
        method: "POST",
        json: { shopName: form.get("shopName"), name: form.get("name"), email: form.get("email"), password: form.get("password") },
      });
      router.push("/dashboard/delivery");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="narrow">
      <form className="card stack" action={submit}>
        <h1>Open your shop</h1>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        <div className="field"><label htmlFor="shopName">Shop name</label><input id="shopName" name="shopName" required minLength={2} /></div>
        <div className="field"><label htmlFor="name">Your name</label><input id="name" name="name" autoComplete="name" required /></div>
        <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="email" required /></div>
        <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required /></div>
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? "Creating…" : "Create shop"}</button>
        <p className="small muted">Already selling? <Link href="/login">Log in</Link></p>
      </form>
    </main>
  );
}
