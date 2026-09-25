// CSV helpers shared by the browser UI and the Node API (single implementation).

export const REVIEW_CSV_HEADERS = ['platform', 'appId', 'lang', 'rating', 'title', 'text', 'author', 'date', 'version', 'helpful', 'replyText', 'url'];

// Review text is user-generated: a cell starting with = + - @ (or a tab/CR) is
// executed as a formula by Excel/Sheets. Prefix those with a quote (OWASP CSV injection).
export function csvCell(value) {
  let raw = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/u.test(raw)) raw = `'${raw}`;
  return /[",\r\n]/u.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

export function toCsv(rows, headers = REVIEW_CSV_HEADERS) {
  const lines = [headers.join(',')];
  for (const row of rows || []) lines.push(headers.map((h) => csvCell(row?.[h])).join(','));
  return lines.join('\r\n');
}
