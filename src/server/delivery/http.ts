import { ProviderUnavailableError, type FetchLike } from "./types.ts";

export interface JsonRequest {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

/**
 * JSON call to a courier API. Any transport failure, timeout or non-2xx
 * becomes ProviderUnavailableError, so checkout can hide that provider's
 * options instead of failing the whole page — and never shows a price the
 * provider didn't return.
 */
export async function requestJson<T>(fetchFn: FetchLike, providerName: string, url: string, req: JsonRequest = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 10_000);
  let response: Response;
  try {
    response = await fetchFn(url, {
      method: req.method ?? "GET",
      headers: { Accept: "application/json", ...(req.body !== undefined ? { "Content-Type": "application/json" } : {}), ...req.headers },
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    throw new ProviderUnavailableError(`${providerName} could not be reached: ${(error as Error).message}`);
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new ProviderUnavailableError(`${providerName} returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProviderUnavailableError(`${providerName} returned a non-JSON response.`);
  }
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
