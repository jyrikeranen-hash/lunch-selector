const { app } = require('@azure/functions');
const { randomUUID } = require('node:crypto');
const store = require('../lib/store');
const { json, error, currentUser, readJson, today } = require('../lib/http');
const { placeInput, visitInput } = require('../lib/validate');

// GET /api/places  → all places
// POST /api/places → add a place
app.http('places', {
  route: 'places',
  methods: ['GET', 'POST'],
  authLevel: 'anonymous', // access control is enforced by Static Web Apps routes
  handler: async (request, context) => {
    if (request.method === 'GET') return json(200, await store.listPlaces());

    const body = await readJson(request);
    if (!body) return error(400, 'Expected a JSON object');
    let data;
    try {
      data = placeInput(body);
    } catch (e) {
      return error(400, e.message);
    }
    const place = await store.createPlace(randomUUID(), {
      ...data,
      visited: false,
      visitCount: 0,
      createdBy: currentUser(request),
      createdAt: new Date().toISOString(),
    });
    context.log(`Place created: ${place.id}`);
    return json(201, place);
  },
});

// PUT /api/places/{id}    → edit
// DELETE /api/places/{id} → remove
app.http('place', {
  route: 'places/{id}',
  methods: ['PUT', 'DELETE'],
  authLevel: 'anonymous',
  handler: async (request) => {
    const { id } = request.params;
    if (request.method === 'DELETE') {
      return (await store.deletePlace(id)) ? { status: 204 } : error(404, 'Place not found');
    }
    const body = await readJson(request);
    if (!body) return error(400, 'Expected a JSON object');
    let data;
    try {
      data = placeInput(body, { partial: true });
    } catch (e) {
      return error(400, e.message);
    }
    const place = await store.updatePlace(id, { ...data, updatedAt: new Date().toISOString() });
    if (!place) return error(404, 'Place not found');

    // Menu settings changed → drop today's cached menu so the next fetch uses them.
    if (['menuUrl', 'menuSelector', 'menuSliceByDay'].some((k) => k in data)) {
      await store.deleteCachedMenu(today().date, id);
    }
    return json(200, place);
  },
});

// POST /api/places/{id}/visit   → log a visit (marks as visited)
// DELETE /api/places/{id}/visit → unmark visited
app.http('visit', {
  route: 'places/{id}/visit',
  methods: ['POST', 'DELETE'],
  authLevel: 'anonymous',
  handler: async (request) => {
    const { id } = request.params;
    const existing = await store.getPlace(id);
    if (!existing) return error(404, 'Place not found');

    if (request.method === 'DELETE') {
      return json(
        200,
        await store.updatePlace(id, {
          visited: false,
          visitCount: 0,
          firstVisitedAt: '',
          lastVisitedAt: '',
          lastVisitedBy: '',
        }),
      );
    }

    let input;
    try {
      input = visitInput((await readJson(request)) || {});
    } catch (e) {
      return error(400, e.message);
    }
    const now = new Date().toISOString();
    const update = {
      visited: true,
      visitCount: (existing.visitCount || 0) + 1,
      firstVisitedAt: existing.firstVisitedAt || now,
      lastVisitedAt: now,
      lastVisitedBy: currentUser(request),
    };
    if (input.rating) update.rating = input.rating;
    if (input.comment) update.lastComment = input.comment;
    return json(200, await store.updatePlace(id, update));
  },
});
