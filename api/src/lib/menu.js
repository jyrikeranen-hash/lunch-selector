const dns = require('node:dns').promises;
const net = require('node:net');
const cheerio = require('cheerio');

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;
const MAX_MENU_CHARS = 6000;

// Monday = 0. Finnish, English and Swedish day names cover most local lunch pages.
const DAY_NAMES = [
  ['maanantai', 'monday', 'måndag'],
  ['tiistai', 'tuesday', 'tisdag'],
  ['keskiviikko', 'wednesday', 'onsdag'],
  ['torstai', 'thursday', 'torsdag'],
  ['perjantai', 'friday', 'fredag'],
  ['lauantai', 'saturday', 'lördag'],
  ['sunnuntai', 'sunday', 'söndag'],
];

// ---------------------------------------------------------------------------
// Fetching (with basic SSRF protection: menu URLs are user-supplied)
// ---------------------------------------------------------------------------

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
}

async function assertPublicUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http(s) URLs are allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error('URL resolves to a private or reserved address');
  }
  return url;
}

function detectCharset(contentType, headBytes) {
  const fromHeader = /charset=([\w-]+)/i.exec(contentType || '');
  if (fromHeader) return fromHeader[1];
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(headBytes.toString('latin1'));
  return fromMeta ? fromMeta[1] : 'utf-8';
}

async function readCapped(response) {
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > MAX_BYTES) throw new Error('Page is too large');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function fetchPage(rawUrl, fetchImpl = fetch) {
  let url = await assertPublicUrl(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetchImpl(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'user-agent': 'LunchListBot/1.0 (+team lunch list; fetches once per day)',
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'fi,en;q=0.8,sv;q=0.6',
      },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = await assertPublicUrl(new URL(res.headers.get('location'), url).toString());
      continue;
    }
    if (!res.ok) throw new Error(`Menu page returned HTTP ${res.status}`);
    const bytes = await readCapped(res);
    const charset = detectCharset(res.headers.get('content-type'), bytes.subarray(0, 2048));
    let decoder;
    try {
      decoder = new TextDecoder(charset);
    } catch {
      decoder = new TextDecoder('utf-8');
    }
    return decoder.decode(bytes);
  }
  throw new Error('Too many redirects');
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

const BLOCK_TAGS =
  'p,div,li,tr,h1,h2,h3,h4,h5,h6,section,article,header,footer,table,ul,ol,dt,dd,blockquote,pre';

/** Turn an HTML fragment into readable lines of text. */
function htmlToLines($, root) {
  const $root = $(root).clone();
  $root.find('script,style,noscript,svg,iframe,form,nav').remove();
  $root.find('br').replaceWith('\n');
  $root.find(BLOCK_TAGS).each((_, el) => {
    $(el).prepend('\n').append('\n');
  });
  $root.find('td,th').append(' ');
  return $root
    .text()
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function dayIndexAtLineStart(line) {
  const lower = line.toLowerCase();
  for (let i = 0; i < DAY_NAMES.length; i++) {
    for (const name of DAY_NAMES[i]) {
      if (lower.startsWith(name)) {
        const next = lower.charAt(name.length);
        // Allow "Maanantai", "Maanantai 6.10.", "Monday:", but not "maanantaisin".
        if (!next || !/[a-zåäö]/.test(next)) return i;
      }
    }
  }
  return -1;
}

/**
 * If the text lists several weekdays, return only today's section.
 * Returns null when today's heading isn't found (caller falls back to full text).
 */
function sliceToday(lines, weekday) {
  const start = lines.findIndex((l) => dayIndexAtLineStart(l) === weekday);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const d = dayIndexAtLineStart(lines[i]);
    if (d !== -1 && d !== weekday) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end);
}

/**
 * @param {string} html
 * @param {{selector?: string, sliceByDay?: boolean, weekday: number}} opts
 * @returns {{text: string, note: string|null}}
 */
function extractMenu(html, { selector, sliceByDay = true, weekday }) {
  const $ = cheerio.load(html);
  let roots = selector ? $(selector) : $('main').length ? $('main') : $('body');
  let note = null;
  if (selector && roots.length === 0) {
    note = `Selector "${selector}" matched nothing; showing the whole page.`;
    roots = $('body');
  }
  let lines = roots.toArray().flatMap((el) => htmlToLines($, el));

  if (sliceByDay) {
    const todays = sliceToday(lines, weekday);
    if (todays) lines = todays;
    else note = note || "Couldn't find today's weekday heading; showing the whole section.";
  }

  let text = lines.join('\n');
  if (text.length > MAX_MENU_CHARS) {
    text = text.slice(0, MAX_MENU_CHARS) + '\n…';
    note = note || 'Menu text was truncated. Set a CSS selector to narrow it down.';
  }
  return { text, note };
}

module.exports = { fetchPage, extractMenu, sliceToday, isPrivateAddress, assertPublicUrl, DAY_NAMES };
