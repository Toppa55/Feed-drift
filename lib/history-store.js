const PREFIX = "feed-drift/history/";

function isEnabled() {
  // New Vercel Blob connections use project-scoped OIDC by default.
  // BLOB_STORE_ID indicates the project is connected to a Blob store.
  // Keep supporting the legacy static token as a fallback.
  return Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
}

async function blobSdk() {
  return import("@vercel/blob");
}

function normalizeSession(session) {
  if (!session || typeof session !== "object") throw new Error("Invalid session.");
  const createdAt = Number(session.createdAt) || Date.now();
  const id = String(session.id || `${createdAt}-${crypto.randomUUID()}`);
  const fp = session.fingerprint || {};
  const keys = ["sexualized","fitness_body","relationships_dating","humor","tech_work","negative_conflict","luxury_status"];
  const fingerprint = {};
  for (const key of keys) {
    const n = Number(fp[key]);
    fingerprint[key] = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
  }
  return {
    id,
    createdAt,
    mood: session.mood == null ? null : Number(session.mood),
    frameCount: Math.max(1, Number(session.frameCount) || 1),
    highSexualShare: Number.isFinite(Number(session.highSexualShare)) ? Number(session.highSexualShare) : (fingerprint.sexualized >= 60 ? 100 : 0),
    fingerprint,
    source: session.source === "automatic" ? "automatic" : "manual",
    model: String(session.model || "gpt-5.6-luna")
  };
}

async function saveSession(session) {
  if (!isEnabled()) return { stored: false, reason: "BLOB_READ_WRITE_TOKEN is not configured." };
  const clean = normalizeSession(session);
  const { put } = await blobSdk();
  await put(`${PREFIX}${clean.id}.json`, JSON.stringify(clean), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false
  });
  return { stored: true, session: clean };
}

async function readBlobJson(pathname) {
  const { get } = await blobSdk();
  const result = await get(pathname, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) return null;
  const text = await new Response(result.stream).text();
  return normalizeSession(JSON.parse(text));
}

async function listSessions(limit = 200) {
  if (!isEnabled()) return { enabled: false, sessions: [] };
  const { list } = await blobSdk();
  let cursor;
  const blobs = [];
  do {
    const page = await list({ prefix: PREFIX, limit: Math.min(1000, Math.max(1, limit)), cursor });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor && blobs.length < limit);

  const selected = blobs
    .sort((a,b) => String(b.pathname).localeCompare(String(a.pathname)))
    .slice(0, limit);

  const sessions = (await Promise.all(selected.map(b => readBlobJson(b.pathname).catch(() => null))))
    .filter(Boolean)
    .sort((a,b) => a.createdAt - b.createdAt);

  return { enabled: true, sessions };
}

async function deleteSession(id) {
  if (!isEnabled()) return { deleted: false, reason: "Storage is not configured." };
  const { list, del } = await blobSdk();
  const pathname = `${PREFIX}${String(id)}.json`;
  const found = await list({ prefix: pathname, limit: 5 });
  const blob = found.blobs.find(b => b.pathname === pathname);
  if (!blob) return { deleted: false, reason: "Not found." };
  await del(blob.url);
  return { deleted: true };
}

async function deleteAllSessions() {
  if (!isEnabled()) return { deleted: 0 };
  const { list, del } = await blobSdk();
  let cursor;
  let deleted = 0;
  do {
    const page = await list({ prefix: PREFIX, limit: 1000, cursor });
    if (page.blobs.length) {
      await del(page.blobs.map(b => b.url));
      deleted += page.blobs.length;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return { deleted };
}

module.exports = { isEnabled, normalizeSession, saveSession, listSessions, deleteSession, deleteAllSessions };
