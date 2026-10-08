/** Small helpers shared by the HTTP functions. */

const json = (status, body) => ({ status, jsonBody: body });
const error = (status, message) => json(status, { error: message });

/**
 * Static Web Apps passes the signed-in user in the x-ms-client-principal header
 * (base64 JSON). Returns a display name, or 'anonymous' when running locally without auth.
 */
function currentUser(request) {
  const header = request.headers.get('x-ms-client-principal');
  if (!header) return 'anonymous';
  try {
    const principal = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
    return principal.userDetails || principal.userId || 'unknown';
  } catch {
    return 'unknown';
  }
}

async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

/** Date + weekday in the configured time zone (default Europe/Helsinki). */
function today(now = new Date(), timeZone = process.env.TIME_ZONE || 'Europe/Helsinki') {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'long',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: weekdays.indexOf(parts.weekday) };
}

module.exports = { json, error, currentUser, readJson, today };
