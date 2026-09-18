const { isEnabled, normalizeSession, saveSession, listSessions, deleteSession, deleteAllSessions } = require("../lib/history-store");

function cors(req, res) {
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Feed-Drift-Token");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Cache-Control", "no-store");
}

function authorised(req) {
  if (!process.env.FEED_DRIFT_TOKEN) return false;
  const supplied = req.headers["x-feed-drift-token"] || req.query?.token;
  return supplied === process.env.FEED_DRIFT_TOKEN;
}

module.exports = async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!process.env.FEED_DRIFT_TOKEN) return res.status(503).json({ error: "Server is missing FEED_DRIFT_TOKEN." });
  if (!authorised(req)) return res.status(401).json({ error: "Feed Drift access token is incorrect." });

  try {
    if (req.method === "GET") {
      const result = await listSessions(250);
      return res.status(200).json(result);
    }

    if (req.method === "POST") {
      if (!isEnabled()) return res.status(200).json({ enabled: false, stored: false });
      const clean = normalizeSession(req.body);
      const result = await saveSession(clean);
      return res.status(200).json({ enabled: true, ...result });
    }

    if (req.method === "DELETE") {
      if (String(req.query?.all || "") === "1") {
        const result = await deleteAllSessions();
        return res.status(200).json({ enabled: isEnabled(), ...result });
      }
      const id = String(req.query?.id || "");
      if (!id) return res.status(400).json({ error: "Missing session id." });
      const result = await deleteSession(id);
      return res.status(200).json({ enabled: isEnabled(), ...result });
    }

    return res.status(405).json({ error: "Method not allowed." });
  } catch (err) {
    console.error("FEED_DRIFT_HISTORY_ERROR", err);
    return res.status(500).json({ error: err?.message || "History request failed." });
  }
};
