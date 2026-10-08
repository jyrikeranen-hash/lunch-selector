const { TableClient } = require('@azure/data-tables');

const PLACES_TABLE = 'places';
const MENU_TABLE = 'menucache';
const PLACE_PK = 'place';

const clients = new Map();

/** Returns a TableClient, creating the table on first use. */
async function table(name) {
  if (!clients.has(name)) {
    const conn = process.env.STORAGE_CONNECTION_STRING;
    if (!conn) throw new Error('STORAGE_CONNECTION_STRING is not set');
    const client = TableClient.fromConnectionString(conn, name, {
      allowInsecureConnection: conn.includes('UseDevelopmentStorage') || conn.includes('127.0.0.1'),
    });
    const ready = client.createTable().catch((err) => {
      if (err.statusCode !== 409) throw err; // 409 = already exists
    });
    clients.set(name, { client, ready });
  }
  const { client, ready } = clients.get(name);
  await ready;
  return client;
}

const places = () => table(PLACES_TABLE);
const menus = () => table(MENU_TABLE);

/** Strip Table Storage metadata so the API returns clean JSON. */
function toPlace(entity) {
  const { partitionKey, rowKey, etag, timestamp, 'odata.metadata': _m, ...rest } = entity;
  return { id: rowKey, ...rest };
}

async function listPlaces() {
  const client = await places();
  const out = [];
  for await (const e of client.listEntities({ queryOptions: { filter: `PartitionKey eq '${PLACE_PK}'` } })) {
    out.push(toPlace(e));
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'fi'));
  return out;
}

async function getPlace(id) {
  const client = await places();
  try {
    return toPlace(await client.getEntity(PLACE_PK, id));
  } catch (err) {
    if (err.statusCode === 404) return null;
    throw err;
  }
}

async function createPlace(id, data) {
  const client = await places();
  await client.createEntity({ partitionKey: PLACE_PK, rowKey: id, ...data });
  return getPlace(id);
}

/** Merge-update; returns null if the place doesn't exist. */
async function updatePlace(id, data) {
  const client = await places();
  try {
    await client.updateEntity({ partitionKey: PLACE_PK, rowKey: id, ...data }, 'Merge');
  } catch (err) {
    if (err.statusCode === 404) return null;
    throw err;
  }
  return getPlace(id);
}

async function deletePlace(id) {
  const client = await places();
  try {
    await client.deleteEntity(PLACE_PK, id);
    return true;
  } catch (err) {
    if (err.statusCode === 404) return false;
    throw err;
  }
}

async function getCachedMenu(date, id) {
  const client = await menus();
  try {
    const e = await client.getEntity(date, id);
    return { date, text: e.text || '', error: e.error || null, fetchedAt: e.fetchedAt, sourceUrl: e.sourceUrl };
  } catch (err) {
    if (err.statusCode === 404) return null;
    throw err;
  }
}

async function putCachedMenu(date, id, menu) {
  const client = await menus();
  await client.upsertEntity({ partitionKey: date, rowKey: id, ...menu }, 'Replace');
}

async function deleteCachedMenu(date, id) {
  const client = await menus();
  await client.deleteEntity(date, id).catch((err) => {
    if (err.statusCode !== 404) throw err;
  });
}

module.exports = {
  listPlaces,
  getPlace,
  createPlace,
  updatePlace,
  deletePlace,
  getCachedMenu,
  putCachedMenu,
  deleteCachedMenu,
};
