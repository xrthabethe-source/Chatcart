// South Africa is UTC+2 all year (no DST), so SAST wall-clock maths is a
// fixed offset — no timezone database needed.
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

/** YYYY-MM-DD of `date` in SAST. */
export function sastDate(date: Date): string {
  return new Date(date.getTime() + SAST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Minutes since SAST midnight. */
export function sastMinutesOfDay(date: Date): number {
  const d = new Date(date.getTime() + SAST_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** "14:00" → 840. Returns null for malformed input. */
export function parseTimeOfDay(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function isWeekend(ymd: string): boolean {
  const day = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Working days (Mon–Fri) from `from` to `to`, by SAST calendar date;
 * 0 when `to` is the same day. Public holidays aren't excluded — the
 * provider's own dates already account for them; this only phrases them.
 */
export function workingDaysBetween(from: Date, to: Date): number {
  let cursor = sastDate(from);
  const end = sastDate(to);
  let days = 0;
  while (cursor < end) {
    const next = new Date(`${cursor}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    cursor = next.toISOString().slice(0, 10);
    if (!isWeekend(cursor)) days += 1;
  }
  return days;
}

/** Adds working days to a date (SAST calendar), keeping the time of day. */
export function addWorkingDays(date: Date, days: number): Date {
  const result = new Date(date);
  let remaining = days;
  while (remaining > 0) {
    result.setTime(result.getTime() + 24 * 60 * 60 * 1000);
    if (!isWeekend(sastDate(result))) remaining -= 1;
  }
  return result;
}

export function etaLabel(minDays: number | null, maxDays: number | null): string | null {
  if (minDays === null && maxDays === null) return null;
  const min = minDays ?? maxDays!;
  const max = maxDays ?? minDays!;
  if (max === 0) return "Today";
  if (max === 1 && min <= 1) return min === 0 ? "Today or tomorrow" : "Next working day";
  if (min === max) return `${max} working days`;
  return `${Math.max(min, 1)}-${max} working days`;
}
