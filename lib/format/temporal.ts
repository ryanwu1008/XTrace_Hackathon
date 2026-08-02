const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function formatTemporalForDisplay(input: {
  value: string;
  dateOnly: Intl.DateTimeFormatOptions;
  timestamp: Intl.DateTimeFormatOptions;
  locale?: string;
}): string {
  const dateOnly = ISO_DATE_ONLY.test(input.value);
  return new Intl.DateTimeFormat(input.locale ?? "en", {
    ...(dateOnly ? input.dateOnly : input.timestamp),
    ...(dateOnly ? { timeZone: "UTC" } : {}),
  }).format(new Date(
    dateOnly ? `${input.value}T00:00:00.000Z` : input.value,
  ));
}
