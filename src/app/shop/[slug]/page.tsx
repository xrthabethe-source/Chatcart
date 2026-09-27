import type { Metadata } from "next";
import { Storefront } from "./storefront";

export const metadata: Metadata = { title: "Shop" };

export default async function ShopPage({ params }: { params: Promise<{ slug: string }> }) {
  return <Storefront slug={(await params).slug} />;
}
