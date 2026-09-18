const { waitUntil } = require("@vercel/functions");

const MODEL = "gpt-5.6-luna";

function cors(req, res) {
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Feed-Drift-Token");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
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

  let image = typeof req.body?.image === "string" ? req.body.image.trim() : "";
  if (!image) return res.status(400).json({ error: "No image supplied." });
  if (!image.startsWith("data:image/")) image = `data:image/jpeg;base64,${image}`;

  const ok = /^data:image\/(jpeg|jpg|png|webp);base64,/i.test(image);
  if (!ok) return res.status(400).json({ error: "Image must be base64 JPEG, PNG, or WebP." });

  waitUntil(
    analyseOne(image).catch(err => {
      console.error("FEED_DRIFT_CAPTURE_ERROR", err);
    })
  );

  return res.status(202).json({ accepted: true });
};
