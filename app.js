(() => {
  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = "feedDrift.sessions.ai.v1";
  const SETTINGS_KEY = "feedDrift.settings.ai.v1";
  const CATEGORIES = [
    ["sexualized", "Sexualised"],
    ["fitness_body", "Fitness / body"],
    ["relationships_dating", "Dating / relationships"],
    ["humor", "Humour"],
    ["tech_work", "Work / tech"],
    ["negative_conflict", "Negative / conflict"],
    ["luxury_status", "Luxury / status"]
  ];

  let sessions = loadJson(STORAGE_KEY, []);
  let settings = Object.assign({
    apiEndpoint: "/api/analyze",
    accessToken: "",
    baselineCount: 7,
    watchThreshold: 5,
    driftThreshold: 10
  }, loadJson(SETTINGS_KEY, {}));
  let chosenFile = null;
  let selectedMood = null;

  const videoInput = $("videoInput");
  const analyzeBtn = $("analyzeBtn");
  const video = $("video");
  const canvas = $("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently:true });

  function loadJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }
  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }
  function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
  function avg(arr){return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null;}
  function fmtDate(ts){return new Intl.DateTimeFormat(undefined,{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}).format(new Date(ts));}
  function score(v){return v == null ? "—" : `${v.toFixed(1)}`;}
  function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
  function historyEndpoint(){return "/api/history";}
  function authHeaders(extra={}){return settings.accessToken ? {...extra,"X-Feed-Drift-Token":settings.accessToken} : extra;}
  function mergeSessions(remote){
    const map=new Map(sessions.map(s=>[s.id,s]));
    for(const s of remote||[]) if(s&&s.id) map.set(s.id,s);
    sessions=[...map.values()].sort((a,b)=>a.createdAt-b.createdAt);
    save();
  }
  async function syncServerHistory(){
    const pill=$("syncStatus");
    if(!settings.accessToken){if(pill)pill.textContent="Sync needs token";return;}
    try{
      const r=await fetch(historyEndpoint(),{headers:authHeaders(),cache:"no-store"});
      if(!r.ok) throw new Error(`History sync failed (${r.status})`);
      const data=await r.json();
      if(data.enabled){
        mergeSessions(data.sessions||[]);
        if(pill)pill.textContent="Automatic sync on";
        render();
      }else{
        if(pill)pill.textContent="Server storage off";
      }
    }catch(err){
      console.warn(err);
      if(pill)pill.textContent="Sync unavailable";
    }
  }
  async function persistSessionToServer(session){
    if(!settings.accessToken)return false;
    try{
      const r=await fetch(historyEndpoint(),{method:"POST",headers:authHeaders({"Content-Type":"application/json"}),body:JSON.stringify(session)});
      if(!r.ok)return false;
      const data=await r.json();
      if($("syncStatus"))$("syncStatus").textContent=data.enabled?"Automatic sync on":"Server storage off";
      return Boolean(data.stored);
    }catch{return false;}
  }
  async function deleteSessionFromServer(id){
    if(!settings.accessToken)return;
    try{await fetch(`${historyEndpoint()}?id=${encodeURIComponent(id)}`,{method:"DELETE",headers:authHeaders()});}catch{}
  }
  async function resetServerHistory(){
    if(!settings.accessToken)return;
    try{await fetch(`${historyEndpoint()}?all=1`,{method:"DELETE",headers:authHeaders()});}catch{}
  }

  function vectorAverage(list){
    if (!list.length) return null;
    const out = {};
    for (const [key] of CATEGORIES) out[key] = avg(list.map(s => s.fingerprint?.[key] ?? 0));
    return out;
  }
  function baselineInfo(list){
    if (!list.length) return {vector:null,kind:"none",used:0};
    const base = list.slice().sort((a,b)=>a.createdAt-b.createdAt).slice(0,settings.baselineCount);
    const good = base.filter(s => s.mood != null && s.mood >= 4);
    const chosen = good.length >= 3 ? good : base;
    return {vector:vectorAverage(chosen),kind:good.length>=3?"good":"all",used:chosen.length};
  }
  function rolling48h(list){
    if (!list.length) return null;
    const newest = Math.max(...list.map(s=>s.createdAt));
    return vectorAverage(list.filter(s=>s.createdAt >= newest - 48*60*60*1000));
  }
  function pearson(points){
    if (points.length < 3) return null;
    const xs=points.map(p=>p.x), ys=points.map(p=>p.y), mx=avg(xs), my=avg(ys);
    let num=0,dx=0,dy=0;
    for(let i=0;i<points.length;i++){const a=xs[i]-mx,b=ys[i]-my;num+=a*b;dx+=a*a;dy+=b*b;}
    const den=Math.sqrt(dx*dy); return den ? num/den : null;
  }

  function render(){
    sessions.sort((a,b)=>a.createdAt-b.createdAt);
    const latest=sessions.at(-1), n=sessions.length;
    const bInfo=baselineInfo(sessions), base=bInfo.vector, recent=rolling48h(sessions);
    const delta=(base&&recent)?recent.sexualized-base.sexualized:null;

    $("ringValue").textContent=n;
    const progress=clamp(n/settings.baselineCount,0,1);
    $("ring").style.background=`conic-gradient(#91a6bb 0deg,#91a6bb ${progress*360}deg,rgba(255,255,255,.12) ${progress*360}deg)`;
    $("sexualNow").textContent=latest?score(latest.fingerprint.sexualized):"—";
    $("baselineValue").textContent=base?score(base.sexualized):"—";
    $("baselineCaption").textContent=n<settings.baselineCount
      ? `${settings.baselineCount-n} scan${settings.baselineCount-n===1?"":"s"} left in learning phase`
      : bInfo.kind==="good"?`Good-state baseline from ${bInfo.used} mood-rated scans`:`Based on your first ${settings.baselineCount} scans`;

    if(delta==null){
      $("driftValue").textContent="—"; $("statusLabel").textContent="Learning your baseline";
      $("driftCaption").textContent="Complete your first AI scan to begin."; $("sexualTrend").textContent=latest?"First reading captured":"No data yet"; $("statusDot").className="dot";
    } else {
      const signed=`${delta>=0?"+":""}${delta.toFixed(1)} pts`;
      $("driftValue").textContent=signed; $("sexualTrend").textContent=`${signed} vs personal baseline`;
      if(n<settings.baselineCount){$("statusLabel").textContent="Learning your baseline";$("driftCaption").textContent="Early comparison only — your reference is still learning.";$("statusDot").className="dot";}
      else if(delta>=settings.driftThreshold){$("statusLabel").textContent="Feed is drifting";$("driftCaption").textContent="Your recent sexualised-content score is meaningfully above your baseline.";$("statusDot").className="dot drift";}
      else if(delta>=settings.watchThreshold){$("statusLabel").textContent="Worth noticing";$("driftCaption").textContent="Your sexualised-content score has moved above its usual range.";$("statusDot").className="dot watch";}
      else{$("statusLabel").textContent="Near your baseline";$("driftCaption").textContent="Your recent feed is broadly within your usual range.";$("statusDot").className="dot good";}
    }
    renderFingerprint(latest,base); renderChart(); renderPatternInsight(); renderHistory();
  }

  function renderFingerprint(latest,base){
    const el=$("fingerprint");
    if(!latest){el.innerHTML='<div class="empty small-empty">Your category fingerprint will appear after your first scan.</div>';return;}
    el.innerHTML=CATEGORIES.map(([key,label])=>{
      const v=latest.fingerprint[key]??0, d=base? v-base[key] : null;
      const note=d==null?"":`${d>=0?"+":""}${d.toFixed(1)} vs baseline`;
      return `<div class="fp-row"><div class="fp-label">${label}<div class="fp-note">${note}</div></div><div class="fp-track"><div class="fp-fill" style="width:${clamp(v,0,100)}%"></div></div><div class="fp-value">${v.toFixed(0)}</div></div>`;
    }).join("");
  }
  function renderChart(){
    const chart=$("trendChart"); if(!sessions.length){chart.innerHTML='<div class="empty">Your trend will appear after your first scan.</div>';return;}
    const list=sessions.slice(-14), max=Math.max(40,...list.map(s=>s.fingerprint.sexualized));
    chart.innerHTML='<div class="bars">'+list.map(s=>{const h=clamp((s.fingerprint.sexualized/max)*100,2,100);const label=new Intl.DateTimeFormat(undefined,{day:"numeric",month:"short"}).format(new Date(s.createdAt));return `<div class="bar-wrap" title="${s.fingerprint.sexualized.toFixed(1)}"><div class="bar" style="height:${h}%"></div><div class="bar-label">${label}</div></div>`;}).join("")+'</div>';
  }
  function renderPatternInsight(){
    const el=$("patternInsight"); const rated=sessions.filter(s=>s.mood!=null).map(s=>({x:s.fingerprint.sexualized,y:s.mood}));
    if(rated.length<5){el.textContent=`Mood link is still learning — ${5-rated.length} more mood-rated scan${5-rated.length===1?"":"s"} would give a first rough comparison. After that, mood check-ins can be occasional.`;return;}
    const r=pearson(rated); if(r==null){el.textContent="There is not enough variation in the current mood check-ins to estimate a relationship yet.";return;}
    const a=Math.abs(r), strength=a>=.65?"strong":a>=.4?"moderate":a>=.2?"weak":"little";
    if(r<-.2) el.textContent=`Personal pattern: your logged data currently shows a ${strength} tendency for higher sexualised-content scores to accompany lower mood (r=${r.toFixed(2)}). This is correlation only, not a diagnosis or causal claim.`;
    else if(r>.2) el.textContent=`Personal pattern: your logged data currently shows a ${strength} tendency for higher sexualised-content scores to accompany higher mood (r=${r.toFixed(2)}). This is correlation only and may change with more data.`;
    else el.textContent=`Personal pattern: there is currently little linear relationship between sexualised-content score and your mood check-ins (r=${r.toFixed(2)}).`;
  }
  function renderHistory(){
    const el=$("history"); if(!sessions.length){el.innerHTML="";return;}
    el.innerHTML=sessions.slice().reverse().slice(0,10).map(s=>`<div class="history-row"><div><div class="history-date">${fmtDate(s.createdAt)}</div><div class="history-meta">${s.source==="automatic"?"Automatic sample":`${s.frameCount} AI frames`}${s.mood?` · mood ${s.mood}/5`:""} · high-sexual ${Number(s.highSexualShare||0).toFixed(0)}%</div></div><div class="history-score">${s.fingerprint.sexualized.toFixed(1)}</div><button class="history-delete" data-delete="${s.id}" aria-label="Delete scan">✕</button></div>`).join("");
    el.querySelectorAll("[data-delete]").forEach(btn=>btn.addEventListener("click",async()=>{const id=btn.dataset.delete;sessions=sessions.filter(s=>s.id!==id);save();render();await deleteSessionFromServer(id);}));
  }

  videoInput.addEventListener("change",()=>{chosenFile=videoInput.files?.[0]??null;$("fileRow").classList.toggle("hidden",!chosenFile);$("fileName").textContent=chosenFile?`${chosenFile.name} · ${(chosenFile.size/1024/1024).toFixed(1)} MB`:"";analyzeBtn.disabled=!chosenFile;});
  $("clearFileBtn").addEventListener("click",()=>{chosenFile=null;videoInput.value="";$("fileRow").classList.add("hidden");analyzeBtn.disabled=true;});
  $("moodButtons").querySelectorAll("button").forEach(btn=>btn.addEventListener("click",()=>{selectedMood=Number(btn.dataset.mood);$("moodButtons").querySelectorAll("button").forEach(b=>b.classList.toggle("active",b===btn));}));

  function waitEvent(target,event,timeout=15000){return new Promise((resolve,reject)=>{const ok=()=>{clean();resolve();},bad=()=>{clean();reject(new Error(`Could not read video (${event}).`));},timer=setTimeout(()=>{clean();reject(new Error(`Timed out waiting for ${event}.`));},timeout);function clean(){clearTimeout(timer);target.removeEventListener(event,ok);target.removeEventListener("error",bad);}target.addEventListener(event,ok,{once:true});target.addEventListener("error",bad,{once:true});});}
  async function seekTo(t){if(Math.abs(video.currentTime-t)<.03)return;const p=waitEvent(video,"seeked",12000);video.currentTime=t;await p;}

  function sampleTimes(duration,every,maxFrames){
    const usableStart=Math.min(1,duration*.03), usableEnd=Math.max(usableStart,duration-Math.min(1,duration*.03));
    const usable=Math.max(.1,usableEnd-usableStart); const desired=Math.max(1,Math.floor(usable/every)); const count=Math.min(maxFrames,desired);
    return Array.from({length:count},(_,i)=>usableStart+usable*((i+.5)/count));
  }
  async function extractFrames(file,every,maxFrames){
    const url=URL.createObjectURL(file);
    try{
      video.src=url;video.load();if(video.readyState<1)await waitEvent(video,"loadedmetadata",20000);
      if(!Number.isFinite(video.duration)||video.duration<=0)throw new Error("The recording duration could not be read.");
      const times=sampleTimes(video.duration,every,maxFrames); const targetWidth=Math.min(384,video.videoWidth||384);const ratio=(video.videoHeight||720)/(video.videoWidth||384);canvas.width=targetWidth;canvas.height=Math.round(targetWidth*ratio);
      const images=[];
      for(let i=0;i<times.length;i++){
        await seekTo(times[i]);ctx.drawImage(video,0,0,canvas.width,canvas.height);images.push(canvas.toDataURL("image/jpeg",.68));
        $("progressBar").style.width=`${10+(i+1)/times.length*38}%`;$("progressText").textContent="Sampling your feed…";$("progressCount").textContent=`${i+1}/${times.length}`;await sleep(0);
      }
      return {images,duration:video.duration};
    } finally {URL.revokeObjectURL(url);video.removeAttribute("src");video.load();}
  }

  async function callAI(images){
    const endpoint=(settings.apiEndpoint||"/api/analyze").trim();
    const headers={"Content-Type":"application/json"}; if(settings.accessToken)headers["X-Feed-Drift-Token"]=settings.accessToken;
    const res=await fetch(endpoint,{method:"POST",headers,body:JSON.stringify({images})});
    let data={}; try{data=await res.json();}catch{}
    if(!res.ok)throw new Error(data.error||`AI backend returned ${res.status}.`);
    if(!Array.isArray(data.frames)||!data.frames.length)throw new Error("AI returned no frame scores.");
    return data;
  }

  analyzeBtn.addEventListener("click",async()=>{
    if(!chosenFile)return; analyzeBtn.disabled=true;$("progressWrap").classList.remove("hidden");$("modelNotice").classList.add("hidden");$("progressBar").style.width="4%";$("progressText").textContent="Preparing recording…";$("progressCount").textContent="";
    try{
      const every=Number($("sampleEvery").value),maxFrames=Number($("maxFrames").value);
      const extracted=await extractFrames(chosenFile,every,maxFrames);
      $("progressBar").style.width="55%";$("progressText").textContent="AI is reading the feed…";$("progressCount").textContent=`${extracted.images.length} frames`;
      const result=await callAI(extracted.images);$("progressBar").style.width="92%";$("progressText").textContent="Building your feed fingerprint…";
      const frames=result.frames.slice(0,extracted.images.length); const fingerprint={};
      for(const [key] of CATEGORIES) fingerprint[key]=avg(frames.map(f=>Number(f[key])||0))||0;
      const highSexualShare=100*frames.filter(f=>(Number(f.sexualized)||0)>=60).length/frames.length;
      const session={id:crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random()}`,createdAt:Date.now(),mood:selectedMood,frameCount:frames.length,highSexualShare,fingerprint,sampleEverySeconds:every,videoDurationSeconds:extracted.duration,model:result.model||"gpt-5.6-luna"};
      sessions.push(session);save();persistSessionToServer(session);$("progressBar").style.width="100%";$("progressText").textContent="Scan complete";$("progressCount").textContent=`Sexualised ${fingerprint.sexualized.toFixed(1)}`;
      chosenFile=null;videoInput.value="";$("fileRow").classList.add("hidden");selectedMood=null;$("moodButtons").querySelectorAll("button").forEach(b=>b.classList.remove("active"));render();setTimeout(()=>$("progressWrap").classList.add("hidden"),2400);
    } catch(err){console.error(err);let msg=err.message;if(/404|backend/i.test(msg))msg += " Open Settings and check the AI endpoint. GitHub Pages alone cannot hold the private OpenAI key; the backend needs to be deployed separately or with Vercel.";$("modelNotice").textContent=`Could not complete the AI scan: ${msg}`;$("modelNotice").classList.remove("hidden");$("progressText").textContent="Scan stopped";
    } finally {analyzeBtn.disabled=!chosenFile;}
  });

  const dialog=$("settingsDialog");
  $("settingsBtn").addEventListener("click",()=>{$("apiEndpoint").value=settings.apiEndpoint||"/api/analyze";$("accessToken").value=settings.accessToken||"";$("baselineCount").value=settings.baselineCount;$("watchThreshold").value=settings.watchThreshold;$("driftThreshold").value=settings.driftThreshold;if(!dialog.open)dialog.showModal();});
  $("closeSettingsBtn").addEventListener("click",(e)=>{e.preventDefault();dialog.close();});
  $("saveSettingsBtn").addEventListener("click",async(e)=>{e.preventDefault();settings.apiEndpoint=$("apiEndpoint").value.trim()||"/api/analyze";settings.accessToken=$("accessToken").value.trim();settings.baselineCount=clamp(Number($("baselineCount").value)||7,3,30);settings.watchThreshold=clamp(Number($("watchThreshold").value)||5,1,50);settings.driftThreshold=clamp(Number($("driftThreshold").value)||10,2,60);if(settings.driftThreshold<=settings.watchThreshold)settings.driftThreshold=settings.watchThreshold+1;save();render();dialog.close();await syncServerHistory();});
  dialog.addEventListener("click",(e)=>{if(e.target===dialog)dialog.close();});
  $("resetBtn").addEventListener("click",async()=>{if(!confirm("Delete all Feed Drift scan history from this browser and synced server history?"))return;sessions=[];save();render();dialog.close();await resetServerHistory();});
  $("exportBtn").addEventListener("click",()=>{const payload=JSON.stringify({exportedAt:new Date().toISOString(),settings:{...settings,accessToken:"[not exported]"},sessions},null,2);const blob=new Blob([payload],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`feed-drift-export-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);});

  if("serviceWorker" in navigator&&location.protocol.startsWith("http"))window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
  render();
  syncServerHistory();
})();
