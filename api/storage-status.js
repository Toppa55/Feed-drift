module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  return res.status(200).json({
    blobConfigured: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    ready: Boolean(process.env.BLOB_READ_WRITE_TOKEN && process.env.FEED_DRIFT_TOKEN && process.env.OPENAI_API_KEY)
  });
};
