(() => {
  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = "feedDrift.sessions.v1";
  const SETTINGS_KEY = "feedDrift.settings.v1";

  let sessions = loadJson(STORAGE_KEY, []);
  let settings = Object.assign({
    baselineCount: 7,
    watchThreshold: 5,
    driftThreshold: 10,
  }, loadJson(SETTINGS_KEY, {}));
  let chosenFile = null;
  let selectedMood = null;
  let model = null;
  let modelPromise = null;

  const videoInput = $("videoInput");
  const analyzeBtn = $("analyzeBtn");
  const video = $("video");
  const canvas = $("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  function loadJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  }
  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function avg(arr) { return arr.length ? arr.reduce((a,b)=>a+b,0) / arr.length : null; }
  function pct(v, digits=0) { return v == null ? "—" : `${v.toFixed(digits)}%`; }
  function fmtDate(ts) {
    return new Intl.DateTimeFormat(undefined, { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" }).format(new Date(ts));
  }
  function startOfDay(ts) {
    const d = new Date(ts); d.setHours(0,0,0,0); return d.getTime();
  }

  function baselineInfo(list) {
    if (!list.length) return { value:null, kind:"none", used:0 };
    const base = list.slice().sort((a,b)=>a.createdAt-b.createdAt).slice(0, settings.baselineCount);
    const good = base.filter(s => s.mood != null && s.mood >= 4);
    // Prefer the user's own "doing well" scans once there are enough of them.
    if (good.length >= 3) {
      return { value:avg(good.map(s=>s.sexualExposurePct)), kind:"good", used:good.length };
    }
    return { value:avg(base.map(s=>s.sexualExposurePct)), kind:"all", used:base.length };
  }

  function pearson(points) {
    if (points.length < 3) return null;
    const xs = points.map(p=>p.x), ys = points.map(p=>p.y);
    const mx = avg(xs), my = avg(ys);
    let num=0, dx=0, dy=0;
    for (let i=0;i<points.length;i++) {
      const a=xs[i]-mx, b=ys[i]-my;
      num += a*b; dx += a*a; dy += b*b;
    }
    const den = Math.sqrt(dx*dy);
    return den ? num/den : null;
  }

  function rollingTwoDay(list) {
    if (!list.length) return null;
    const newest = Math.max(...list.map(s=>s.createdAt));
    const cutoff = newest - (48 * 60 * 60 * 1000);
    const values = list.filter(s=>s.createdAt >= cutoff).map(s=>s.sexualExposurePct);
    return avg(values);
  }

  function render() {
    sessions.sort((a,b)=>a.createdAt-b.createdAt);
    const bInfo = baselineInfo(sessions);
    const baseline = bInfo.value;
    const latest = sessions.at(-1);
    const twoDay = rollingTwoDay(sessions);
    const delta = (baseline != null && twoDay != null) ? twoDay - baseline : null;
    const n = sessions.length;

    $("ringValue").textContent = n;
    const progress = clamp(n / settings.baselineCount, 0, 1);
    $("ring").style.background = `conic-gradient(#91a6bb 0deg, #91a6bb ${progress*360}deg, rgba(255,255,255,.12) ${progress*360}deg)`;

    $("sexualNow").textContent = latest ? pct(latest.sexualExposurePct, 1) : "—";
    $("baselineValue").textContent = baseline != null ? pct(baseline, 1) : "—";
    $("baselineCaption").textContent = n < settings.baselineCount
      ? `${settings.baselineCount - n} scan${settings.baselineCount-n===1?"":"s"} left in learning phase`
      : (bInfo.kind === "good"
          ? `Good-state baseline from ${bInfo.used} mood-rated scans`
          : `Based on your first ${settings.baselineCount} scans`);

    if (delta == null) {
      $("driftValue").textContent = "—";
      $("driftCaption").textContent = "Complete your first scan to begin.";
      $("statusLabel").textContent = n ? "Learning your baseline" : "Learning your baseline";
      $("sexualTrend").textContent = latest ? "First reading captured" : "No data yet";
      $("statusDot").className = "dot";
    } else {
      const signed = `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} pp`;
      $("driftValue").textContent = signed;
      $("sexualTrend").textContent = `${signed} vs personal baseline`;
      if (n < settings.baselineCount) {
        $("statusLabel").textContent = "Learning your baseline";
        $("driftCaption").textContent = "Early comparison only — the reference is still learning.";
        $("statusDot").className = "dot";
      } else if (delta >= settings.driftThreshold) {
        $("statusLabel").textContent = "Feed is drifting";
        $("driftCaption").textContent = "Your recent sexual-content exposure is meaningfully above your baseline.";
        $("statusDot").className = "dot drift";
      } else if (delta >= settings.watchThreshold) {
        $("statusLabel").textContent = "Worth noticing";
        $("driftCaption").textContent = "Your feed has moved above its usual range.";
        $("statusDot").className = "dot watch";
      } else {
        $("statusLabel").textContent = "Near your baseline";
        $("driftCaption").textContent = "Your recent feed is broadly within your usual range.";
        $("statusDot").className = "dot good";
      }
    }
    renderChart();
    renderPatternInsight();
    renderHistory();
  }

  function renderChart() {
    const chart = $("trendChart");
    if (!sessions.length) {
      chart.innerHTML = '<div class="empty">Your trend will appear after your first scan.</div>';
      return;
    }
    const list = sessions.slice(-14);
    const max = Math.max(40, ...list.map(s=>s.sexualExposurePct));
    chart.innerHTML = '<div class="bars">' + list.map(s => {
      const h = clamp((s.sexualExposurePct/max)*100, 2, 100);
      const label = new Intl.DateTimeFormat(undefined,{day:"numeric",month:"short"}).format(new Date(s.createdAt));
      return `<div class="bar-wrap" title="${s.sexualExposurePct.toFixed(1)}%">
        <div class="bar" style="height:${h}%"></div>
        <div class="bar-label">${label}</div>
      </div>`;
    }).join("") + '</div>';
  }

  function renderPatternInsight() {
    const el = $("patternInsight");
    const rated = sessions.filter(s => s.mood != null).map(s => ({ x:s.sexualExposurePct, y:s.mood }));
    if (rated.length < 5) {
      el.textContent = `Mood link is still learning — ${5-rated.length} more mood-rated scan${5-rated.length===1?"":"s"} would give a first rough comparison. Mood check-ins can become occasional after the learning period.`;
      return;
    }
    const r = pearson(rated);
    if (r == null) {
      el.textContent = "There is not enough variation in the current mood check-ins to estimate a relationship yet.";
      return;
    }
    const abs = Math.abs(r);
    let strength = abs >= .65 ? "strong" : abs >= .4 ? "moderate" : abs >= .2 ? "weak" : "little";
    if (r < -.2) {
      el.textContent = `Personal pattern: your logged data currently shows a ${strength} tendency for higher sexual-content exposure to accompany lower mood (r=${r.toFixed(2)}). This is correlation only, not a diagnosis or a causal claim.`;
    } else if (r > .2) {
      el.textContent = `Personal pattern: your logged data currently shows a ${strength} tendency for higher sexual-content exposure to accompany higher mood (r=${r.toFixed(2)}). This is correlation only and can change as more data is added.`;
    } else {
      el.textContent = `Personal pattern: there is currently little linear relationship between sexual-content exposure and your mood check-ins (r=${r.toFixed(2)}). More data may change this.`;
    }
  }

  function renderHistory() {
    const el = $("history");
    if (!sessions.length) { el.innerHTML = ""; return; }
    el.innerHTML = sessions.slice().reverse().slice(0,10).map(s => `
      <div class="history-row">
        <div>
          <div class="history-date">${fmtDate(s.createdAt)}</div>
          <div class="history-meta">${s.frameCount} samples${s.mood ? ` · mood ${s.mood}/5` : ""}</div>
        </div>
        <div class="history-score">${s.sexualExposurePct.toFixed(1)}%</div>
        <button class="history-delete" data-delete="${s.id}" aria-label="Delete scan">✕</button>
      </div>
    `).join("");
    el.querySelectorAll("[data-delete]").forEach(btn => btn.addEventListener("click", () => {
      sessions = sessions.filter(s => s.id !== btn.dataset.delete);
      save(); render();
    }));
  }

  videoInput.addEventListener("change", () => {
    chosenFile = videoInput.files?.[0] ?? null;
    $("fileRow").classList.toggle("hidden", !chosenFile);
    $("fileName").textContent = chosenFile ? `${chosenFile.name} · ${(chosenFile.size/1024/1024).toFixed(1)} MB` : "";
    analyzeBtn.disabled = !chosenFile;
  });

  $("clearFileBtn").addEventListener("click", () => {
    chosenFile = null;
    videoInput.value = "";
    $("fileRow").classList.add("hidden");
    analyzeBtn.disabled = true;
  });

  $("moodButtons").querySelectorAll("button").forEach(btn => btn.addEventListener("click", () => {
    selectedMood = Number(btn.dataset.mood);
    $("moodButtons").querySelectorAll("button").forEach(b => b.classList.toggle("active", b===btn));
  }));

  async function ensureModel() {
    if (model) return model;
    if (modelPromise) return modelPromise;
    modelPromise = (async () => {
      if (!window.tf || !window.nsfwjs) throw new Error("AI libraries did not load. Check your internet connection.");
      tf.enableProdMode();
      await tf.ready();
      // NSFWJS 4.x includes model definitions; the model weights are fetched once and cached by the browser when possible.
      return await nsfwjs.load("MobileNetV2");
    })();
    model = await modelPromise;
    return model;
  }

  function waitEvent(target, event, timeout=15000) {
    return new Promise((resolve, reject) => {
      const onOk = () => { cleanup(); resolve(); };
      const onErr = () => { cleanup(); reject(new Error(`Could not read video (${event}).`)); };
      const timer = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${event}.`)); }, timeout);
      function cleanup() {
        clearTimeout(timer);
        target.removeEventListener(event,onOk);
        target.removeEventListener("error",onErr);
      }
      target.addEventListener(event,onOk,{once:true});
      target.addEventListener("error",onErr,{once:true});
    });
  }

  async function seekTo(t) {
    if (Math.abs(video.currentTime - t) < 0.03) return;
    const p = waitEvent(video, "seeked", 12000);
    video.currentTime = t;
    await p;
  }

  function sexualScore(predictions) {
    const wanted = new Set(["Sexy","Porn","Hentai"]);
    return predictions.filter(p=>wanted.has(p.className)).reduce((sum,p)=>sum+p.probability,0);
  }

  analyzeBtn.addEventListener("click", async () => {
    if (!chosenFile) return;
    analyzeBtn.disabled = true;
    $("progressWrap").classList.remove("hidden");
    $("modelNotice").classList.add("hidden");
    $("progressBar").style.width = "2%";
    $("progressText").textContent = "Loading on-device classifier…";
    $("progressCount").textContent = "";

    let url;
    try {
      const classifier = await ensureModel();
      $("progressBar").style.width = "8%";
      $("progressText").textContent = "Reading recording…";

      url = URL.createObjectURL(chosenFile);
      video.src = url;
      video.load();
      if (video.readyState < 1) await waitEvent(video, "loadedmetadata", 20000);

      if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error("The recording duration could not be read.");

      const every = Number($("sampleEvery").value);
      const threshold = Number($("sexualThreshold").value);
      const maxFrames = 90;
      const duration = Math.min(video.duration, every * maxFrames);
      let times = [];
      for (let t = Math.min(0.5, duration/3); t < duration; t += every) times.push(t);
      if (!times.length) times = [0];

      const targetWidth = Math.min(360, video.videoWidth || 360);
      const ratio = (video.videoHeight || 640) / (video.videoWidth || 360);
      canvas.width = targetWidth;
      canvas.height = Math.round(targetWidth * ratio);

      let flagged = 0;
      let scoreSum = 0;
      let processed = 0;

      for (let i=0;i<times.length;i++) {
        await seekTo(times[i]);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const predictions = await classifier.classify(canvas, 5);
        const score = sexualScore(predictions);
        scoreSum += score;
        if (score >= threshold) flagged++;
        processed++;
        const progress = 8 + (processed/times.length)*88;
        $("progressBar").style.width = `${progress}%`;
        $("progressText").textContent = "Analysing feed exposure…";
        $("progressCount").textContent = `${processed}/${times.length}`;
        await new Promise(r=>setTimeout(r,0));
      }

      const session = {
        id: (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`),
        createdAt: Date.now(),
        mood: selectedMood,
        frameCount: processed,
        flaggedFrames: flagged,
        threshold,
        sexualExposurePct: processed ? (flagged / processed) * 100 : 0,
        meanSexualScorePct: processed ? (scoreSum / processed) * 100 : 0,
        sampleEverySeconds: every,
        videoDurationSeconds: video.duration
      };
      sessions.push(session);
      save();

      $("progressBar").style.width = "100%";
      $("progressText").textContent = "Scan complete";
      $("progressCount").textContent = `${session.sexualExposurePct.toFixed(1)}% exposure`;

      chosenFile = null;
      videoInput.value = "";
      $("fileRow").classList.add("hidden");
      selectedMood = null;
      $("moodButtons").querySelectorAll("button").forEach(b=>b.classList.remove("active"));
      render();

      setTimeout(() => $("progressWrap").classList.add("hidden"), 2200);
    } catch (err) {
      console.error(err);
      $("modelNotice").textContent = `Could not complete the automatic scan: ${err.message} The app needs internet on the first run so the on-device model can load.`;
      $("modelNotice").classList.remove("hidden");
      $("progressText").textContent = "Scan stopped";
    } finally {
      if (url) URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
      analyzeBtn.disabled = !chosenFile;
    }
  });

  const dialog = $("settingsDialog");
  $("settingsBtn").addEventListener("click", () => {
    $("baselineCount").value = settings.baselineCount;
    $("watchThreshold").value = settings.watchThreshold;
    $("driftThreshold").value = settings.driftThreshold;
    dialog.showModal();
  });
  $("saveSettingsBtn").addEventListener("click", () => {
    settings.baselineCount = clamp(Number($("baselineCount").value)||7,3,30);
    settings.watchThreshold = clamp(Number($("watchThreshold").value)||5,1,50);
    settings.driftThreshold = clamp(Number($("driftThreshold").value)||10,2,60);
    if (settings.driftThreshold <= settings.watchThreshold) settings.driftThreshold = settings.watchThreshold + 1;
    save(); render();
  });
  $("resetBtn").addEventListener("click", () => {
    if (!confirm("Delete all Feed Drift scan history from this browser?")) return;
    sessions = [];
    save();
    render();
    dialog.close();
  });
  $("exportBtn").addEventListener("click", () => {
    const payload = JSON.stringify({ exportedAt:new Date().toISOString(), settings, sessions }, null, 2);
    const blob = new Blob([payload], {type:"application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `feed-drift-export-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  });

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(()=>{}));
  }

  render();
})();