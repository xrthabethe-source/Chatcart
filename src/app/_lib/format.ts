// Deterministic (not toLocaleString): server and browser ICU data differ
// on en-ZA separators, which would break hydration and look inconsistent.
export function rands(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const fraction = abs % 100;
  return `${negative ? "-" : ""}R${whole}${fraction ? `.${fraction.toString().padStart(2, "0")}` : ""}`;
}

/** 27821234567 → 082 123 4567 */
export function localPhone(phone: string): string {
  const local = phone.startsWith("27") && phone.length === 11 ? `0${phone.slice(2)}` : phone;
  return local.length === 10 ? `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}` : local;
}

export function dateTime(value: string | Date): string {
  return new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Johannesburg" }).format(new Date(value));
}

/** Rands input ("59.95") → cents, or null when blank/invalid. */
export function toCents(value: string): number | null {
  const trimmed = value.trim().replace(/^R\s*/i, "").replace(/\s/g, "").replace(",", ".");
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { ...(init?.json !== undefined ? { "Content-Type": "application/json" } : {}), ...init?.headers },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message ?? `Request failed (${response.status})`);
  return data as T;
}
