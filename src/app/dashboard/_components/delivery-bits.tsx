import type { Destination, ShipmentStatus } from "@/server/delivery/types";
import { STATUS_LABELS } from "@/server/delivery/status";

const METHOD_CHIP: Record<string, { label: string; className: string }> = {
  PAXI_PICKUP: { label: "PAXI", className: "chip chip-paxi" },
  DOOR_COURIER: { label: "Courier", className: "chip chip-brand" },
  SAME_DAY: { label: "Same-day", className: "chip chip-warn" },
  SELLER_COLLECTION: { label: "Collection", className: "chip" },
};

export function MethodChip({ method }: { method: string }) {
  const chip = METHOD_CHIP[method] ?? { label: method, className: "chip" };
  return <span className={chip.className}>{chip.label}</span>;
}

export function StatusChip({ status }: { status: ShipmentStatus }) {
  const tone =
    status === "DELIVERED" ? "chip chip-ok"
    : status === "EXCEPTION" || status === "CANCELLED" ? "chip chip-danger"
    : status === "READY_TO_BOOK" || status === "READY_FOR_REGISTRATION" ? "chip chip-warn"
    : "chip chip-brand";
  return <span className={tone}>{STATUS_LABELS[status]}</span>;
}

export function shortDestination(d: Destination): string {
  if (d.kind === "PICKUP_POINT") return d.location.name;
  if (d.kind === "ADDRESS") return `${d.address.suburb}, ${d.address.city}`;
  return "Collect from you";
}
