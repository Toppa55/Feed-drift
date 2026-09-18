# Feed Drift — MVP

Feed Drift is a local-first prototype for detecting changes in the visual character of your Instagram feed relative to your own baseline.

## What this version does

- Accepts an iPhone/Android/desktop screen recording.
- Samples one frame every 1.5–3 seconds.
- Runs NSFWJS in the browser and converts its `Sexy`, `Porn`, and `Hentai` probabilities into a *sexual-content exposure* signal.
- Stores only scan summaries in browser `localStorage`; the selected video is not saved by the app.
- Builds an initial baseline from the first 7 scans by default.
- Compares the latest 48-hour average with that baseline and shows Stable / Watch / Drifting states.
- Allows an optional 1–5 mood check-in during the learning period.
- Exports summary data as JSON.
- Installs as a PWA when served over HTTPS.

## Important limitations

This is a personal pattern detector, not a diagnostic or clinical tool. The image classifier will make mistakes. Treat the value as a repeatable signal to compare with your own history, not an objective measure of sexual content.

The first run requires an internet connection to fetch TensorFlow.js, NSFWJS and its model. Classification then runs in the browser. For a production/private deployment, vendor the JS and model assets into the project instead of loading them from a CDN.

## Easiest iPhone setup

1. Upload this folder to any static HTTPS host (GitHub Pages, Netlify, Cloudflare Pages, etc.).
2. Open the site in Safari.
3. Share → Add to Home Screen.
4. Screen-record 60–120 seconds of normal Instagram scrolling.
5. Open Feed Drift and select the recording.
6. Repeat periodically; the first 7 scans form the default baseline.

## Local desktop test

From the folder:

    python -m http.server 8080

Then open `http://localhost:8080`.

## Privacy model

Raw screen recordings are opened through a browser object URL, sampled in memory, and released after analysis. Only aggregate metrics are written to localStorage. This prototype does not upload the recording to a backend.
