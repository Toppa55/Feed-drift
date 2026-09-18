# Feed Drift — AI vision MVP

Feed Drift detects changes in the visual character of a person's social-media feed relative to their own baseline.

## What changed in v0.3

- Replaced the generic NSFW classifier with OpenAI vision (`gpt-5.6-luna`).
- The browser extracts up to 24 JPEG frames from a screen recording. The full recording is never uploaded.
- AI scores every frame from 0–100 for: sexualised content, fitness/body, dating/relationships, humour, work/tech, negative/conflict, and luxury/status.
- The app creates a multi-dimensional feed fingerprint and tracks the sexualised-content score against the user's baseline.
- AI credentials are kept server-side. Never put an OpenAI API key in `app.js` or browser localStorage.

## Recommended deployment: Vercel

GitHub Pages can host the front end but cannot safely hold an OpenAI API key. Vercel can host both the front end and `/api/analyze` from this same repository.

1. Import this GitHub repository into Vercel.
2. Add two Vercel environment variables:
   - `OPENAI_API_KEY` = your OpenAI API key
   - `FEED_DRIFT_TOKEN` = a long random private string you invent
3. Deploy.
4. Open the Vercel URL in Safari and add it to the iPhone Home Screen.
5. In Feed Drift Settings, keep AI endpoint as `/api/analyze` and paste your `FEED_DRIFT_TOKEN` into the Feed Drift access-token field.

Do not share either secret publicly. `FEED_DRIFT_TOKEN` protects the personal API endpoint from casual third-party use; the OpenAI key never goes to the browser.

## Privacy model

- The selected screen recording stays in the browser.
- The browser extracts a maximum of 24 reduced JPEG screenshots.
- Those screenshots are sent to the Feed Drift backend and then to OpenAI for analysis.
- Feed Drift stores only category scores, timestamps and optional mood check-ins in localStorage.
- The backend uses `store: false` for the OpenAI Responses API.

## Interpretation

This is a personal pattern detector, not a diagnostic tool. A rise in a category is an observation about the user's feed relative to their own history, not evidence that the category caused a mood change or that a mental-health condition is present.
