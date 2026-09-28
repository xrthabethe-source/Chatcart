"use client";
import Link from "next/link";
import { useState } from "react";

interface Props {
  shopUrl: string;
  shareText: string;
  whatsappShareUrl: string;
  steps: { products: boolean; delivery: boolean; payments: boolean };
}

// Top of the orders page: finish setup, then share the shop.
export function ShareCard({ shopUrl, shareText, whatsappShareUrl, steps }: Props) {
  const [copied, setCopied] = useState(false);
  const todo = [
    !steps.products && "choose your products",
    !steps.delivery && "set up delivery",
    !steps.payments && "set up payments",
  ].filter(Boolean) as string[];

  if (todo.length) {
    return (
      <div className="card share-card stack">
        <div><strong>Finish setting up your shop</strong></div>
        <div className="small muted">Still to do: {todo.join(", ")}.</div>
        <div><Link className="btn btn-primary" href="/dashboard/setup">Continue setup</Link></div>
      </div>
    );
  }
  return (
    <div className="card share-card stack">
      <div className="spread">
        <div><strong>Your shop link</strong></div>
        <span className="mono small" style={{ wordBreak: "break-all" }}>{shopUrl}</span>
      </div>
      <div className="row">
        <a className="btn btn-primary btn-sm" href={whatsappShareUrl} target="_blank" rel="noreferrer">Share on WhatsApp</a>
        <button
          className="btn btn-sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(shareText);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied ✓" : "Copy status message"}
        </button>
      </div>
    </div>
  );
}
