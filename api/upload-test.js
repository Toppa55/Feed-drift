module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") return res.status(405).send("POST only");

  const contentType = String(req.headers["content-type"] || "unknown");
  let size = 0;
  let bodyType = typeof req.body;

  try {
    if (Buffer.isBuffer(req.body)) {
      size = req.body.length;
      bodyType = "Buffer";
    } else if (req.body instanceof Uint8Array) {
      size = req.body.byteLength;
      bodyType = "Uint8Array";
    } else if (typeof req.body === "string") {
      size = Buffer.byteLength(req.body);
      bodyType = "string";
    } else if (req.body && typeof req.body === "object") {
      const s = JSON.stringify(req.body);
      size = Buffer.byteLength(s);
      bodyType = "object";
    }
  } catch {}

  return res.status(200).send(`UPLOAD OK | type=${contentType} | body=${bodyType} | size=${size}`);
};
