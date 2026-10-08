const test = require('node:test');
const assert = require('node:assert');
const { extractMenu, isPrivateAddress, assertPublicUrl } = require('../src/lib/menu');
const { today } = require('../src/lib/http');
const { placeInput, visitInput } = require('../src/lib/validate');

const WEEK_HTML = `
<html><body>
  <nav>Etusivu | Yhteystiedot</nav>
  <div class="lunch">
    <h3>Maanantai 5.10.</h3><p>Lihakeitto 12,50 €</p>
    <h3>Tiistai 6.10.</h3><p>Broileria ja riisiä<br>Kasvislasagne (V)</p>
    <h3>Keskiviikko 7.10.</h3><p>Lohikeitto</p>
  </div>
  <footer>Avoinna ma–pe 10.30–14</footer>
</body></html>`;

test('slices today from a week menu (Finnish headings)', () => {
  const { text, note } = extractMenu(WEEK_HTML, { selector: '.lunch', weekday: 1 });
  assert.strictEqual(text, 'Tiistai 6.10.\nBroileria ja riisiä\nKasvislasagne (V)');
  assert.strictEqual(note, null);
});

test('last day runs to end of section', () => {
  const { text } = extractMenu(WEEK_HTML, { selector: '.lunch', weekday: 2 });
  assert.strictEqual(text, 'Keskiviikko 7.10.\nLohikeitto');
});

test('English and Swedish headings work', () => {
  const html = '<main><p>Monday: soup</p><p>Torsdag: fisk</p><p>Friday: pizza</p></main>';
  assert.strictEqual(extractMenu(html, { weekday: 3 }).text, 'Torsdag: fisk');
});

test('words that merely start with a day name are not headings', () => {
  const html = '<main><p>Maanantaisin buffet</p><p>Maanantai</p><p>Keitto</p></main>';
  assert.strictEqual(extractMenu(html, { weekday: 0 }).text, 'Maanantai\nKeitto');
});

test('falls back to full text with a note when today is missing', () => {
  const { text, note } = extractMenu(WEEK_HTML, { selector: '.lunch', weekday: 4 });
  assert.match(text, /Lihakeitto/);
  assert.match(note, /weekday heading/);
});

test('no slicing when disabled; scripts and nav removed', () => {
  const html = '<body><nav>menu</nav><script>x=1</script><p>Päivän lounas: pasta</p></body>';
  assert.strictEqual(extractMenu(html, { sliceByDay: false, weekday: 0 }).text, 'Päivän lounas: pasta');
});

test('unmatched selector falls back to body with a note', () => {
  const { text, note } = extractMenu('<body><p>Keitto</p></body>', { selector: '#nope', sliceByDay: false, weekday: 0 });
  assert.strictEqual(text, 'Keitto');
  assert.match(note, /matched nothing/);
});

test('private address detection', () => {
  for (const ip of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '172.20.0.1', '192.168.1.1', '::1', 'fd00::1', '::ffff:10.0.0.1']) {
    assert.ok(isPrivateAddress(ip), ip);
  }
  for (const ip of ['8.8.8.8', '172.32.0.1', '2001:4860:4860::8888']) {
    assert.ok(!isPrivateAddress(ip), ip);
  }
});

test('rejects non-http and private URLs', async () => {
  await assert.rejects(assertPublicUrl('file:///etc/passwd'), /http/);
  await assert.rejects(assertPublicUrl('http://169.254.169.254/metadata'), /private/);
  await assert.rejects(assertPublicUrl('http://localhost:7071/'), /private/);
});

test('today() uses Helsinki time', () => {
  // 2026-10-08 22:30 UTC is already Friday 9 Oct in Helsinki (UTC+3)
  assert.deepStrictEqual(today(new Date('2026-10-08T22:30:00Z')), { date: '2026-10-09', weekday: 4 });
});

test('place validation', () => {
  assert.throws(() => placeInput({}), /name is required/);
  assert.throws(() => placeInput({ name: 'X', menuUrl: 'javascript:alert(1)' }), /http/);
  const p = placeInput({ name: ' Cafe ', menuUrl: 'https://example.com/lounas' });
  assert.strictEqual(p.name, 'Cafe');
  assert.strictEqual(p.menuSliceByDay, true);
  assert.deepStrictEqual(placeInput({ notes: 'hi' }, { partial: true }), { notes: 'hi' });
  assert.throws(() => visitInput({ rating: 6 }), /rating/);
});
