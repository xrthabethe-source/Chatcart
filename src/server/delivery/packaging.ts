// Parcel size/weight for a cart. MVP strategy, deliberately simple:
//
// - If every item has full dimensions and weight, stack them: the parcel
//   is as long/wide as the largest item and as tall as all items stacked,
//   weighing the sum (plus packaging allowance). Over-estimates volume for
//   flat items, which only ever errs towards a slightly higher quote —
//   never an under-declared parcel the courier re-bills.
// - Otherwise fall back to the seller's default parcel, taking the larger
//   of the default weight and the known item weights.
//
// A real bin-packing strategy can replace `calculateParcel` later without
// touching callers.
import type { Parcel } from "./types.ts";

export interface PackableItem {
  quantity: number;
  weightGrams: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
}

export interface DefaultParcel {
  defaultParcelLengthCm: number;
  defaultParcelWidthCm: number;
  defaultParcelHeightCm: number;
  defaultParcelWeightGrams: number;
}

const PACKAGING_WEIGHT_GRAMS = 100;

export function calculateParcel(items: PackableItem[], defaults: DefaultParcel): Parcel {
  const knownWeight = items.reduce((sum, i) => sum + (i.weightGrams ?? 0) * i.quantity, 0);
  const allDimensioned =
    items.length > 0 && items.every((i) => i.weightGrams && i.lengthCm && i.widthCm && i.heightCm);

  if (allDimensioned) {
    const dims = items.map((i) => [i.lengthCm!, i.widthCm!, i.heightCm!].sort((a, b) => b - a) as [number, number, number]);
    return {
      lengthCm: Math.max(...dims.map((d) => d[0])),
      widthCm: Math.max(...dims.map((d) => d[1])),
      heightCm: dims.reduce((sum, d, idx) => sum + d[2] * items[idx]!.quantity, 0),
      weightGrams: knownWeight + PACKAGING_WEIGHT_GRAMS,
    };
  }

  return {
    lengthCm: defaults.defaultParcelLengthCm,
    widthCm: defaults.defaultParcelWidthCm,
    heightCm: defaults.defaultParcelHeightCm,
    weightGrams: Math.max(defaults.defaultParcelWeightGrams, knownWeight + PACKAGING_WEIGHT_GRAMS),
  };
}
