import { TemporalValueV2Schema } from "../contracts/source-evidence";

export interface CurrentPublicationValue {
  publishedAt: string;
  publishedAtPrecision: "date" | "timestamp";
}

export interface CurrentPublicationWindow {
  windowStartAt: string;
  windowEndAt: string;
  windowTimezone: string;
}

function zonedLocalMidnight(date: string, timeZone: string): number | null {
  try {
    const [year, month, day] = date.split("-").map(Number);
    if (!year || !month || !day) return null;
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    let candidate = Date.UTC(year, month - 1, day);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const parts = Object.fromEntries(
        formatter.formatToParts(new Date(candidate))
          .filter(({ type }) => type !== "literal")
          .map(({ type, value }) => [type, Number(value)]),
      );
      const represented = Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second,
      );
      const target = Date.UTC(year, month - 1, day);
      const correction = target - represented;
      candidate += correction;
      if (correction === 0) return candidate;
    }
    return null;
  } catch {
    return null;
  }
}

function nextCalendarDate(date: string): string | null {
  const instant = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(instant)) return null;
  return new Date(instant + 86_400_000).toISOString().slice(0, 10);
}

export function withinPublicationWindow(
  publishedAt: string,
  now: Date,
  days: number,
): boolean;
export function withinPublicationWindow(
  publication: CurrentPublicationValue,
  window: CurrentPublicationWindow,
): boolean;
export function withinPublicationWindow(
  publishedAtOrPublication: string | CurrentPublicationValue,
  nowOrWindow: Date | CurrentPublicationWindow,
  days?: number,
): boolean {
  if (typeof publishedAtOrPublication === "string") {
    const publishedAt = publishedAtOrPublication;
    const now = nowOrWindow as Date;
    const upperBound = now.getTime();
    if (
      !Number.isFinite(upperBound)
      || !Number.isFinite(days)
      || days === undefined
      || days <= 0
    ) return false;
    const lowerBound = upperBound - days * 86_400_000;
    if (/^\d{4}-\d{2}-\d{2}$/u.test(publishedAt)) {
      const earliest = Date.parse(`${publishedAt}T00:00:00.000Z`);
      if (!Number.isFinite(earliest) || new Date(earliest).toISOString().slice(0, 10) !== publishedAt) return false;
      return earliest + 86_400_000 - 1 >= lowerBound && earliest <= upperBound;
    }
    if (!TemporalValueV2Schema.safeParse(publishedAt).success) return false;
    const instant = Date.parse(publishedAt);
    return Number.isFinite(instant) && instant >= lowerBound && instant <= upperBound;
  }

  const publication = publishedAtOrPublication;
  const window = nowOrWindow as CurrentPublicationWindow;
  if (!TemporalValueV2Schema.safeParse(window.windowStartAt).success
    || !TemporalValueV2Schema.safeParse(window.windowEndAt).success) return false;
  const lower = Date.parse(window.windowStartAt);
  const upper = Date.parse(window.windowEndAt);
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower > upper) return false;
  if (publication.publishedAtPrecision === "timestamp") {
    if (!TemporalValueV2Schema.safeParse(publication.publishedAt).success
      || /^\d{4}-\d{2}-\d{2}$/u.test(publication.publishedAt)) return false;
    const instant = Date.parse(publication.publishedAt);
    return Number.isFinite(instant) && instant >= lower && instant <= upper;
  }
  if (publication.publishedAtPrecision !== "date"
    || !/^\d{4}-\d{2}-\d{2}$/u.test(publication.publishedAt)) return false;
  const next = nextCalendarDate(publication.publishedAt);
  if (!next) return false;
  const dayStart = zonedLocalMidnight(publication.publishedAt, window.windowTimezone);
  const dayEnd = zonedLocalMidnight(next, window.windowTimezone);
  return dayStart !== null && dayEnd !== null
    && dayStart <= upper && dayEnd > lower;
}

export const withinWindow = withinPublicationWindow;
