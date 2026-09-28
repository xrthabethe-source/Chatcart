import type { Metadata } from "next";
import Link from "next/link";
import { checkInvite } from "@/server/services/invites";
import { NotFoundError } from "@/server/services/errors";
import { SetupWizard } from "../../_onboarding/setup-wizard";

export const metadata: Metadata = { title: "Open your Chatcart shop" };
export const dynamic = "force-dynamic";

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let invite;
  try {
    invite = await checkInvite(token);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
    return (
      <main className="narrow stack">
        <h1>This link has expired</h1>
        <p className="muted">Invite links work once and expire after a while. Ask the person who invited you for a new one.</p>
        <p className="small">Already opened your shop? <Link href="/login">Log in</Link></p>
      </main>
    );
  }
  return <SetupWizard token={token} invitedName={invite.label} startAt="account" />;
}
