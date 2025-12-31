function formatInTimeZone(date, timeZone, options) {
  if (!date) return '';

  const d = date instanceof Date ? date : new Date(date);

  const makeFormatter = (tz) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      ...(options || {}),
    });

  const tz = timeZone || 'UTC';

  try {
    return makeFormatter(tz).format(d);
  } catch {
    return makeFormatter('UTC').format(d);
  }
}

export { formatInTimeZone };
