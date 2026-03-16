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
