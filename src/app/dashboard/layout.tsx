import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/http/context";
import { isPlatformAdmin } from "@/server/services/auth";
import { LogoutButton } from "./logout-button";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <>
      <header className="topbar">
        <div className="inner">
          <Link href="/dashboard/orders" className="brand">{user.tenantName}</Link>
          <nav aria-label="Dashboard">
            <Link href="/dashboard/orders">Orders</Link>
            <Link href="/dashboard/products">Products</Link>
            <Link href="/dashboard/delivery">Delivery settings</Link>
            <Link href="/dashboard/settings">Shop settings</Link>
            {isPlatformAdmin(user) && <Link href="/dashboard/admin">Admin</Link>}
            <Link href={`/shop/${user.tenantSlug}`} target="_blank">View shop ↗</Link>
          </nav>
          <span style={{ marginLeft: "auto" }}><LogoutButton /></span>
        </div>
      </header>
      {children}
    </>
  );
}
