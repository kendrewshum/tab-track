export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export function formatDate(dateStr: string): string {
  // App dates can be stored either as a calendar date (`YYYY-MM-DD`) or as a
  // SQLite/ISO timestamp. We always want to display the calendar day the user
  // entered, so normalize to the leading date portion before constructing a Date.
  const calendarDate = dateStr.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? dateStr;

  return new Date(`${calendarDate}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function today(): string {
  return new Date().toISOString().split("T")[0];
}
