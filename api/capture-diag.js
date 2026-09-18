async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") return res.status(200).send("METHOD_NOT_POST");

  const tokenHeader = req.headers["x-feed-drift-token"];
  const tokenConfigured = !!process.env.FEED_DRIFT_TOKEN;
  const tokenMatches = tokenConfigured && tokenHeader === process.env.FEED_DRIFT_TOKEN;
  const openaiConfigured = !!process.env.OPENAI_API_KEY;

  const contentType = String(req.headers["content-type"] || "unknown");
  let raw = Buffer.alloc(0);

  try {
    if (Buffer.isBuffer(req.body)) raw = req.body;
    else if (req.body instanceof Uint8Array) raw = Buffer.from(req.body);
    else raw = await readRawBody(req);
  } catch (e) {
    return res.status(200).send(
      `DIAG | tokenConfigured=${tokenConfigured} | tokenMatches=${tokenMatches} | openaiConfigured=${openaiConfigured} | contentType=${contentType} | rawRead=ERROR:${e.message}`
    );
  }

  return res.status(200).send(
    `DIAG | tokenConfigured=${tokenConfigured} | tokenMatches=${tokenMatches} | openaiConfigured=${openaiConfigured} | contentType=${contentType} | size=${raw.length}`
  );
};
