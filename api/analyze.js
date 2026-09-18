const MODEL = "gpt-5.6-luna";
const MAX_IMAGES = 24;

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

module.exports = async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only." });

  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: "Server is missing OPENAI_API_KEY." });
  if (!process.env.FEED_DRIFT_TOKEN) return res.status(503).json({ error: "Server is missing FEED_DRIFT_TOKEN." });
  if (req.headers["x-feed-drift-token"] !== process.env.FEED_DRIFT_TOKEN) return res.status(401).json({ error: "Feed Drift access token is incorrect." });

  const images = Array.isArray(req.body?.images) ? req.body.images.slice(0, MAX_IMAGES) : [];
  if (!images.length) return res.status(400).json({ error: "No frames were supplied." });
  if (images.some(x => typeof x !== "string" || !x.startsWith("data:image/jpeg;base64,"))) return res.status(400).json({ error: "Frames must be JPEG data URLs." });

  const prompt = `You are analysing sampled screenshots from one person's social-media recommendation feed. Each image is a separate chronological sample from the same scan.

For EVERY supplied image, return one score from 0 to 100 for each dimension below. Judge only the visible content; do not identify people and do not infer private traits.

sexualized: How strongly the visible post is presented to invite sexual/physical attraction or sexual attention. This is broader than nudity. Consider thirst-trap presentation, cleavage/body emphasis, lingerie/swimwear used suggestively, provocative posing, erotic framing, or clearly sexual context. Ordinary clothed people, ordinary fashion, or ordinary exercise should stay low unless the presentation itself is distinctly sexualized. 0 = none; 25 = mild attractiveness/body emphasis; 50 = clearly sexualized; 75 = strongly sexualized; 100 = explicit/overwhelming sexual presentation.
fitness_body: fitness, physique, body transformation, exercise, bodybuilding or body-focused wellness.
relationships_dating: romance, dating, couples, breakups, attraction advice or relationship content.
humor: jokes, memes, comedy or content primarily intended to be funny.
tech_work: technology, business, engineering, software, career, productivity or work-related content.
negative_conflict: anger, doom, interpersonal conflict, upsetting events, outrage, hostility or strongly negative emotional framing.
luxury_status: wealth display, expensive cars/watches/travel, aspirational luxury or status signalling.

Scores are independent; several can be high in the same frame. Keep the scoring scale consistent across every image. Return exactly one frame object per input image, in the same order, with index starting at 0.`;

  const content = [{ type: "input_text", text: prompt }];
  for (const image_url of images) content.push({ type: "input_image", image_url, detail: "low" });

  const frameSchema = {
    type: "object",
    additionalProperties: false,
    required: ["index","sexualized","fitness_body","relationships_dating","humor","tech_work","negative_conflict","luxury_status"],
    properties: {
      index: { type: "integer", minimum: 0 },
      sexualized: { type: "number", minimum: 0, maximum: 100 },
      fitness_body: { type: "number", minimum: 0, maximum: 100 },
      relationships_dating: { type: "number", minimum: 0, maximum: 100 },
      humor: { type: "number", minimum: 0, maximum: 100 },
      tech_work: { type: "number", minimum: 0, maximum: 100 },
      negative_conflict: { type: "number", minimum: 0, maximum: 100 },
      luxury_status: { type: "number", minimum: 0, maximum: 100 }
    }
  };

  const body = {
    model: MODEL,
    store: false,
    input: [{ role: "user", content }],
    text: {
      format: {
        type: "json_schema",
        name: "feed_drift_analysis",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["frames"],
          properties: { frames: { type: "array", minItems: 1, maxItems: MAX_IMAGES, items: frameSchema } }
        }
      },
      verbosity: "low"
    }
  };

  try {
    const openai = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await openai.json();
    if (!openai.ok) return res.status(openai.status).json({ error: data?.error?.message || "OpenAI request failed." });
    const text = extractOutputText(data);
    if (!text) return res.status(502).json({ error: "AI returned no structured output." });
    const parsed = JSON.parse(text);
    const frames = Array.isArray(parsed.frames) ? parsed.frames.sort((a,b)=>a.index-b.index) : [];
    if (frames.length !== images.length) return res.status(502).json({ error: `AI scored ${frames.length} frames, expected ${images.length}. Please retry.` });
    return res.status(200).json({ model: MODEL, frames });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Feed analysis failed. Please retry." });
  }
};
