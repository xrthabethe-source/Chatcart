// Outbound WhatsApp transport.
//
// ConsoleWhatsAppSender (default) logs instead of sending, for local and
// test use. MetaWhatsAppSender posts to the Meta Cloud API and is picked
// automatically when WHATSAPP_META_ACCESS_TOKEN is set.
//
// WhatsApp policy: free-form text is allowed only inside the 24h
// customer-service window; business-initiated notifications (shipment
// booked, ready for collection…) must use pre-approved templates. So
// `send` takes both: inside the window the text is sent, outside it the
// named template with its ordered parameters.
export interface OutboundWhatsApp {
  phoneNumberId: string | null;
  /** The shop's own business token when sending from its own number;
   * omitted for the shared Chatcart number (platform token). */
  accessToken?: string | null;
  to: string;
  body: string;
  template: string;
  templateParams: string[];
  withinServiceWindow: boolean;
}

export interface WhatsAppSender {
  send(message: OutboundWhatsApp): Promise<void>;
}

export class ConsoleWhatsAppSender implements WhatsAppSender {
  readonly sent: OutboundWhatsApp[] = [];
  async send(message: OutboundWhatsApp) {
    this.sent.push(message);
    if (process.env.NODE_ENV !== "test") console.log(`[whatsapp → ${message.to}] ${message.body}`);
  }
}

export class MetaWhatsAppSender implements WhatsAppSender {
  private readonly token: string;
  private readonly apiVersion: string;
  private readonly languageCode: string;

  constructor(token: string, apiVersion = "v21.0", languageCode = "en") {
    this.token = token;
    this.apiVersion = apiVersion;
    this.languageCode = languageCode;
  }

  async send(message: OutboundWhatsApp) {
    if (!message.phoneNumberId) throw new Error("Shop has no WhatsApp phone number id configured.");
    const payload = message.withinServiceWindow
      ? { messaging_product: "whatsapp", to: message.to, type: "text", text: { body: message.body } }
      : {
          messaging_product: "whatsapp",
          to: message.to,
          type: "template",
          template: {
            name: message.template,
            language: { code: this.languageCode },
            components: [{ type: "body", parameters: message.templateParams.map((text) => ({ type: "text", text })) }],
          },
        };
    const response = await fetch(`https://graph.facebook.com/${this.apiVersion}/${message.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${message.accessToken || this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`WhatsApp send failed: HTTP ${response.status} ${await response.text()}`);
  }
}

let override: WhatsAppSender | null = null;
let cached: WhatsAppSender | null = null;

export function setWhatsAppSenderForTests(sender: WhatsAppSender | null) {
  override = sender;
}

export function getWhatsAppSender(): WhatsAppSender {
  if (override) return override;
  if (!cached) {
    const token = process.env.WHATSAPP_META_ACCESS_TOKEN ?? "";
    // Must match the language the templates were approved in (Meta's
    // code, e.g. "en" or "en_US").
    const language = process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en";
    const meta = new MetaWhatsAppSender(token, "v21.0", language);
    const log = new ConsoleWhatsAppSender();
    // A connected shop sends with its own token even when the platform
    // has no shared number configured; otherwise messages are logged.
    cached = { send: (m) => (m.accessToken || token ? meta.send(m) : log.send(m)) };
  }
  return cached;
}
