/**
 * Converts a period string to the ISO timestamp marking the start of that period.
 * Uses local midnight for "today" (not UTC midnight) to match the user's timezone.
 */
export function periodToStart(period: string): string {
  const now = new Date();
  switch (period) {
    case "today":
      return new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      ).toISOString();
    case "week": {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      return d.toISOString();
    }
    case "month": {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 1);
      return d.toISOString();
    }
    default:
      return "1970-01-01T00:00:00Z";
  }
}

export function calendarPeriodStart(period: string): string {
  const now = new Date();
  switch (period) {
    case "daily":
      return new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      ).toISOString();
    case "weekly": {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const day = d.getDay();
      const diff = day === 0 ? 6 : day - 1;
      d.setDate(d.getDate() - diff);
      return d.toISOString();
    }
    case "monthly":
      return new Date(
        now.getFullYear(),
        now.getMonth(),
        1,
      ).toISOString();
    default:
      return "1970-01-01T00:00:00.000Z";
  }
}

export function calendarPeriodEnd(period: string): string {
  const now = new Date();
  switch (period) {
    case "daily":
      return new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
      ).toISOString();
    case "weekly": {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const day = d.getDay();
      const diff = day === 0 ? 6 : day - 1;
      d.setDate(d.getDate() - diff + 7);
      return d.toISOString();
    }
    case "monthly":
      return new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        1,
      ).toISOString();
    default:
      return "9999-12-31T23:59:59.999Z";
  }
}

export function daysInPeriod(period: string): number {
  const start = new Date(calendarPeriodStart(period));
  const end = new Date(calendarPeriodEnd(period));
  return (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
}
