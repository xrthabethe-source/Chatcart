// What the customer pays for delivery, from what the courier charges.
//
// Exactly one pricing mode applies per provider, plus an optional free-
// shipping threshold that overrides it — so every total is explainable in
// one sentence ("R89 courier rate + R15 handling", "Free over R500") and
// can never be negative.

export type PricingMode = "EXACT" | "RATE_PLUS_HANDLING";

export interface ShippingPricingConfig {
  pricingMode: PricingMode;
  handlingFeeCents: number;
  markupBps: number;
  freeShippingThresholdCents: number | null;
}

export interface CustomerShippingPrice {
  priceCents: number;
  free: boolean;
  breakdown: string;
}

export class InvalidPricingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPricingConfigError";
  }
}

export function assertValidPricingConfig(config: ShippingPricingConfig): void {
  const ints: [string, number][] = [
    ["Handling fee", config.handlingFeeCents],
    ["Markup", config.markupBps],
  ];
  if (config.freeShippingThresholdCents !== null) ints.push(["Free shipping threshold", config.freeShippingThresholdCents]);
  for (const [label, value] of ints) {
    if (!Number.isInteger(value) || value < 0) throw new InvalidPricingConfigError(`${label} must be zero or more.`);
  }
  if (config.markupBps > 10_000) throw new InvalidPricingConfigError("Markup cannot exceed 100%.");
  if (config.pricingMode === "EXACT" && (config.handlingFeeCents > 0 || config.markupBps > 0)) {
    // Refuse the ambiguous combination instead of silently ignoring the fee.
    throw new InvalidPricingConfigError(
      'Handling fee and markup only apply to "courier rate + handling". Set them to 0 or change the pricing mode.',
    );
  }
}

export function customerShippingPrice(
  providerRateCents: number,
  subtotalCents: number,
  config: ShippingPricingConfig,
): CustomerShippingPrice {
  assertValidPricingConfig(config);
  if (!Number.isInteger(providerRateCents) || providerRateCents < 0) {
    throw new InvalidPricingConfigError("Provider rate must be a non-negative amount in cents.");
  }

  if (config.freeShippingThresholdCents !== null && subtotalCents >= config.freeShippingThresholdCents) {
    return { priceCents: 0, free: true, breakdown: `Free delivery on orders over ${rands(config.freeShippingThresholdCents)}` };
  }

  if (config.pricingMode === "EXACT") {
    return { priceCents: providerRateCents, free: providerRateCents === 0, breakdown: "Courier rate" };
  }

  const markup = Math.round((providerRateCents * config.markupBps) / 10_000);
  const priceCents = providerRateCents + markup + config.handlingFeeCents;
  return { priceCents, free: priceCents === 0, breakdown: "Courier rate + handling" };
}

export function rands(cents: number): string {
  const value = cents / 100;
  return `R${Number.isInteger(value) ? value.toString() : value.toFixed(2)}`;
}
