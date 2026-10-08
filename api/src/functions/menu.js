const { app } = require('@azure/functions');
const store = require('../lib/store');
const { json, error, today } = require('../lib/http');
const { fetchPage, extractMenu } = require('../lib/menu');

// GET /api/places/{id}/menu[?refresh=1]
// Returns today's menu, scraped from the place's menuUrl at most once per day
// (cached in Table Storage) unless refresh=1 is given.
app.http('menu', {
  route: 'places/{id}/menu',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const { id } = request.params;
    const place = await store.getPlace(id);
    if (!place) return error(404, 'Place not found');
    if (!place.menuUrl) return json(200, { date: today().date, text: '', error: 'No menu URL set for this place.' });

    const { date, weekday } = today();
    const refresh = request.query.get('refresh') === '1';
    if (!refresh) {
      const cached = await store.getCachedMenu(date, id);
      if (cached) return json(200, { ...cached, cached: true });
    }

    const menu = { date, sourceUrl: place.menuUrl, fetchedAt: new Date().toISOString(), text: '', error: '' };
    try {
      const html = await fetchPage(place.menuUrl);
      const { text, note } = extractMenu(html, {
        selector: place.menuSelector,
        sliceByDay: place.menuSliceByDay !== false,
        weekday,
      });
      menu.text = text;
      menu.error = note || '';
      await store.putCachedMenu(date, id, menu); // cache successes only; failures retry next time
    } catch (e) {
      context.warn(`Menu fetch failed for ${id}: ${e.message}`);
      menu.error = `Could not fetch menu: ${e.message}`;
    }
    return json(200, { ...menu, error: menu.error || null, cached: false });
  },
});
