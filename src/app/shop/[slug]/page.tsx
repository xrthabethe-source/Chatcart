import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveShop } from "@/server/http/context";
import { NotFoundError } from "@/server/services/errors";
import { SiteFooter } from "../../_lib/site-footer";
import { Storefront } from "./storefront";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  try {
    const shop = await resolveShop((await params).slug);
    return { title: shop.name, description: `Order from ${shop.name}: collect at PEP, delivery or collection. Pay securely.` };
  } catch {
    return { title: "Shop" };
  }
}

export default async function ShopPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let shop;
  try {
    shop = await resolveShop(slug);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  return (
    <>
      <Storefront slug={slug} />
      <SiteFooter seller={{ shopName: shop.name, whatsappNumber: shop.whatsappNumber, cardPayments: !!shop.yocoSecretKeyEncrypted }} />
    </>
  );
}
