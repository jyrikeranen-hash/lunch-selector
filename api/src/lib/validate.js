const LIMITS = { name: 100, address: 200, url: 500, menuUrl: 500, menuSelector: 200, notes: 1000, comment: 500 };

function cleanString(value, field) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const v = value.trim();
  if (v.length > LIMITS[field]) throw new Error(`${field} is too long (max ${LIMITS[field]})`);
  return v;
}

function cleanUrl(value, field) {
  const v = cleanString(value, field);
  if (!v) return '';
  let u;
  try {
    u = new URL(v);
  } catch {
    throw new Error(`${field} is not a valid URL`);
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error(`${field} must be http(s)`);
  return u.toString();
}

/**
 * Validates place fields. With partial=true only the provided fields are returned (for PUT).
 */
function placeInput(body, { partial = false } = {}) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);

  if (!partial || has('name')) {
    out.name = cleanString(body.name, 'name');
    if (!out.name) throw new Error('name is required');
  }
  for (const f of ['address', 'menuSelector', 'notes']) {
    if (!partial || has(f)) out[f] = cleanString(body[f], f);
  }
  for (const f of ['url', 'menuUrl']) {
    if (!partial || has(f)) out[f] = cleanUrl(body[f], f);
  }
  if (!partial || has('menuSliceByDay')) out.menuSliceByDay = body.menuSliceByDay !== false;
  return out;
}

function visitInput(body) {
  const out = { comment: cleanString(body.comment, 'comment') };
  if (body.rating !== undefined && body.rating !== null && body.rating !== '') {
    const r = Number(body.rating);
    if (!Number.isInteger(r) || r < 1 || r > 5) throw new Error('rating must be 1–5');
    out.rating = r;
  }
  return out;
}

module.exports = { placeInput, visitInput };
