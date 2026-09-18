const MODEL = "gpt-5.6-luna";

function cors(req, res) {
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Feed-Drift-Token");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function extractOutputText(data) {
  for (const item of data.output || []) {
    if (item.type !== "message") continue;
    for (const part of item.content || []) {
      if (part.type === "output_text" && part.text) return part.text;
    }
  }
  return null;
}

async function analyseOne(image) {
  const prompt = `You are analysing one screenshot from a person's social-media recommendation feed.

Return 0-100 scores for:
sexualized: sexual/thirst-trap framing, suggestive posing, cleavage/body emphasis, lingerie/swimwear used suggestively, erotic framing or clearly sexual context.
fitness_body: fitness, physique, exercise, bodybuilding, body transformation or body-focused wellness.
relationships_dating: romance, dating, couples, breakups, attraction advice or relationship content.
humor: jokes, memes or comedy.
tech_work: technology, business, engineering, software, career, productivity or work.
negative_conflict: anger, doom, conflict, upsetting events, outrage, hostility or strong negative framing.
luxury_status: wealth display, expensive cars/watches/travel, aspirational luxury or status signalling.

Scores are independent. Judge only visible content. Do not identify people or infer private traits.`;

  const body = {
    model: MODEL,
    store: false,
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: prompt },
        { type: "input_image", image_url: image, detail: "low" }
      ]
    }],
    text: {
      format: {
        type: "json_schema",
        name: "feed_drift_capture",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["sexualized","fitness_body","relationships_dating","humor","tech_work","negative_conflict","luxury_status"],
          properties: {
            sexualized: { type: "number", minimum: 0, maximum: 100 },
            fitness_body: { type: "number", minimum: 0, maximum: 100 },
            relationships_dating: { type: "number", minimum: 0, maximum: 100 },
            humor: { type: "number", minimum: 0, maximum: 100 },
            tech_work: { type: "number", minimum: 0, maximum: 100 },
            negative_conflict: { type: "number", minimum: 0, maximum: 100 },
            luxury_status: { type: "number", minimum: 0, maximum: 100 }
          }
        }
      },
      verbosity: "low"
    }
  };

  const openai = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await openai.json();
  if (!openai.ok) throw new Error(data?.error?.message || "OpenAI request failed.");

  const text = extractOutputText(data);
  if (!text) throw new Error("AI returned no structured output.");

  const scores = JSON.parse(text);
  console.log("FEED_DRIFT_CAPTURE_RESULT", JSON.stringify({
    at: new Date().toISOString(),
    scores
  }));
  return scores;
}

module.exports = async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only." });

  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: "Server is missing OPENAI_API_KEY." });
  if (!process.env.FEED_DRIFT_TOKEN) return res.status(503).json({ error: "Server is missing FEED_DRIFT_TOKEN." });
  if (req.headers["x-feed-drift-token"] !== process.env.FEED_DRIFT_TOKEN) {
    return res.status(401).json({ error: "Feed Drift access token is incorrect." });
  }

  let image = "";

  const contentType = String(req.headers["content-type"] || "").toLowerCase();

  // Preferred iOS Shortcuts path: send the resized JPEG directly.
  if (Buffer.isBuffer(req.body)) {
    const mime = contentType.startsWith("image/") ? contentType.split(";")[0] : "image/jpeg";
    image = `data:${mime};base64,${req.body.toString("base64")}`;
  } else if (req.body instanceof Uint8Array) {
    const mime = contentType.startsWith("image/") ? contentType.split(";")[0] : "image/jpeg";
    image = `data:${mime};base64,${Buffer.from(req.body).toString("base64")}`;
  } else if (contentType.startsWith("image/")) {
    const raw = await readRawBody(req);
    if (raw.length) {
      const mime = contentType.split(";")[0];
      image = `data:${mime};base64,${raw.toString("base64")}`;
    }
  } else if (typeof req.body?.image === "string") {
    // Backward-compatible JSON/base64 path.
    image = req.body.image.trim();
    if (!image.startsWith("data:image/")) image = `data:image/jpeg;base64,${image}`;
  }

  if (!image) return res.status(400).send("No image supplied.");

  const ok = /^data:image\\/(jpeg|jpg|png|webp);base64,/i.test(image);
  if (!ok) return res.status(400).send("Image must be JPEG, PNG, or WebP.");

  try {
    const scores = await analyseOne(image);
    return res.status(200).json({ ok: true, scores });
  } catch (err) {
    console.error("FEED_DRIFT_CAPTURE_ERROR", err);
    return res.status(500).json({ error: err?.message || "Capture analysis failed." });
  }
};
