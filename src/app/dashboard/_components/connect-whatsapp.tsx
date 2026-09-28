"use client";
// "Connect my WhatsApp" — Meta Embedded Signup.
//
// Loads Facebook's JS SDK, opens Meta's signup popup (the seller logs in
// with Facebook, picks their number and confirms in their WhatsApp
// Business app), then hands the one-time code plus the chosen account
// and number to our server, which verifies them with Meta.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "../../_lib/format";

interface Props {
  appId: string;
  configId: string;
  connected: boolean;
  displayNumber: string | null;
  coexistence: boolean;
  templates?: { approved: number; pending: number; rejected: number; total: number } | null;
}

type FBLoginResponse = { authResponse?: { code?: string } | null; status?: string };
type FBStatic = {
  init(opts: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void;
  login(cb: (r: FBLoginResponse) => void, opts: Record<string, unknown>): void;
};
declare global {
  interface Window {
    FB?: FBStatic;
    fbAsyncInit?: () => void;
  }
}

const SDK_URL = "https://connect.facebook.net/en_US/sdk.js";

function loadSdk(appId: string): Promise<FBStatic> {
  return new Promise((resolve, reject) => {
    if (window.FB) return resolve(window.FB);
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version: "v21.0" });
      resolve(window.FB!);
    };
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => reject(new Error("Couldn't load Facebook. Check your connection and try again."));
    document.body.appendChild(script);
  });
}

export function ConnectWhatsApp(props: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error" | "info"; text: string } | null>(null);
  // Meta reports the chosen account/number by window message, separately
  // from the login callback that carries the code; we need both.
  const session = useRef<{ wabaId?: string; phoneNumberId?: string; coexistence?: boolean; cancelled?: boolean }>({});

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!/^https:\/\/([a-z]+\.)?facebook\.com$/.test(event.origin)) return;
      let data: { type?: string; event?: string; data?: { phone_number_id?: string; waba_id?: string } };
      try {
        data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (data?.type !== "WA_EMBEDDED_SIGNUP") return;
      if (data.event === "CANCEL" || data.event === "ERROR") session.current.cancelled = true;
      if (data.event?.startsWith("FINISH") && data.data?.waba_id && data.data.phone_number_id) {
        session.current = {
          wabaId: data.data.waba_id,
          phoneNumberId: data.data.phone_number_id,
          coexistence: data.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
        };
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function connect(keepApp: boolean) {
    setBusy(true);
    setStatus(null);
    session.current = {};
    try {
      const FB = await loadSdk(props.appId);
      const code = await new Promise<string | null>((resolve) =>
        FB.login((r) => resolve(r.authResponse?.code ?? null), {
          config_id: props.configId,
          response_type: "code",
          override_default_response_type: true,
          extras: keepApp
            ? { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" }
            : { setup: {}, sessionInfoVersion: "3" },
        }),
      );
      // The FINISH message can land just after the login callback.
      for (let i = 0; i < 20 && !session.current.wabaId && !session.current.cancelled; i++) await new Promise((r) => setTimeout(r, 250));
      const s = session.current;
      if (!code || s.cancelled || !s.wabaId || !s.phoneNumberId) {
        setStatus({ kind: "info", text: "WhatsApp wasn't connected. You can try again any time." });
        return;
      }
      setStatus({ kind: "info", text: "Connecting… this takes a few seconds." });
      const { whatsapp } = await api<{ whatsapp: { displayNumber: string | null; templatesFailed: string[] } }>("/api/v1/whatsapp/connect", {
        method: "POST",
        json: { code, wabaId: s.wabaId, phoneNumberId: s.phoneNumberId, coexistence: !!s.coexistence },
      });
      setStatus({
        kind: "ok",
        text: `✓ ${whatsapp.displayNumber ?? "Your number"} is connected. Customers now get order updates from your own WhatsApp.${
          whatsapp.templatesFailed.length ? " Some message templates couldn't be submitted. Tap “Connect” again later to retry." : ""
        }`,
      });
      router.refresh();
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await api("/api/v1/whatsapp/connect", { method: "DELETE" });
      setStatus({ kind: "ok", text: "Disconnected. Updates will come from the Chatcart number again." });
      router.refresh();
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const note = status && (
    <div className={`alert ${status.kind === "ok" ? "alert-ok" : status.kind === "error" ? "alert-error" : "alert-warn"} small`} role="status">{status.text}</div>
  );

  if (props.connected) {
    const t = props.templates;
    return (
      <div className="stack">
        {note}
        <div className="alert alert-ok">
          ✓ Connected: <strong>{props.displayNumber}</strong>.{" "}
          {props.coexistence ? "You keep using the WhatsApp Business app on your phone; Chatcart only answers customers who are ordering or tracking." : ""}
        </div>
        {t && (
          <p className="small muted">
            Delivery-update messages: {t.approved} of {t.total} approved by WhatsApp
            {t.pending ? `, ${t.pending} waiting for approval (usually minutes to a day)` : ""}
            {t.rejected ? `, ${t.rejected} rejected. Contact Chatcart support` : ""}.
          </p>
        )}
        <div className="row">
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => connect(props.coexistence)}>Reconnect</button>
          <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={disconnect}>Disconnect</button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      {note}
      <p className="small">
        Send order updates from <strong>your own WhatsApp number</strong> instead of the Chatcart number. You&apos;ll log in with
        Facebook, choose your WhatsApp Business number, and confirm in the WhatsApp Business app. About 5 minutes.
      </p>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => connect(true)}>
        {busy ? "Connecting…" : "Connect my WhatsApp"}
      </button>
      <p className="small muted">
        Your number must be on the <strong>WhatsApp Business</strong> app (free; switching from normal WhatsApp keeps your chats).
        You keep using the app on your phone as normal.{" "}
        <button type="button" className="link small" disabled={busy} onClick={() => connect(false)} style={{ background: "none", border: 0, padding: 0, color: "var(--brand)", textDecoration: "underline", cursor: "pointer" }}>
          Using a new number that isn&apos;t on WhatsApp yet?
        </button>
      </p>
    </div>
  );
}
