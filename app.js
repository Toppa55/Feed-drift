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
    accessToken: "",
    baselineCount: 7,
    watchThreshold: 5,
    driftThreshold: 10
  }, loadJson(SETTINGS_KEY, {}));

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
    if(!settings.accessToken){
      if(pill)pill.textContent="Sync needs token";
      return;
    }
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
      $("driftValue").textContent="—";
      $("statusLabel").textContent="Learning your baseline";
      $("driftCaption").textContent=n ? "Automatic samples are being collected." : "Use Instagram normally — automatic samples will appear here.";
      $("sexualTrend").textContent=latest?"First reading captured":"No data yet";
      $("statusDot").className="dot";
    } else {
      const signed=`${delta>=0?"+":""}${delta.toFixed(1)} pts`;
      $("driftValue").textContent=signed;
      $("sexualTrend").textContent=`${signed} vs personal baseline`;
      if(n<settings.baselineCount){
        $("statusLabel").textContent="Learning your baseline";
        $("driftCaption").textContent="Early comparison only — your reference is still learning.";
        $("statusDot").className="dot";
      } else if(delta>=settings.driftThreshold){
        $("statusLabel").textContent="Feed is drifting";
        $("driftCaption").textContent="Your recent sexualised-content score is meaningfully above your baseline.";
        $("statusDot").className="dot drift";
      } else if(delta>=settings.watchThreshold){
        $("statusLabel").textContent="Worth noticing";
        $("driftCaption").textContent="Your sexualised-content score has moved above its usual range.";
        $("statusDot").className="dot watch";
      } else {
        $("statusLabel").textContent="Near your baseline";
        $("driftCaption").textContent="Your recent feed is broadly within your usual range.";
        $("statusDot").className="dot good";
      }
    }

    renderFingerprint(latest,base);
    renderChart();
    renderPatternInsight();
    renderHistory();
  }

  function renderFingerprint(latest,base){
    const el=$("fingerprint");
    if(!latest){
      el.innerHTML='<div class="empty small-empty">Your category fingerprint will appear after your first automatic sample.</div>';
      return;
    }
    el.innerHTML=CATEGORIES.map(([key,label])=>{
      const v=Number(latest.fingerprint?.[key]??0), d=base? v-base[key] : null;
      const note=d==null?"":`${d>=0?"+":""}${d.toFixed(1)} vs baseline`;
      return `<div class="fp-row"><div class="fp-label">${label}<div class="fp-note">${note}</div></div><div class="fp-track"><div class="fp-fill" style="width:${clamp(v,0,100)}%"></div></div><div class="fp-value">${v.toFixed(0)}</div></div>`;
    }).join("");
  }

  function renderChart(){
    const chart=$("trendChart");
    if(!sessions.length){
      chart.innerHTML='<div class="empty">Your trend will appear after automatic samples arrive.</div>';
      return;
    }
    const list=sessions.slice(-14), max=Math.max(40,...list.map(s=>Number(s.fingerprint?.sexualized||0)));
    chart.innerHTML='<div class="bars">'+list.map(s=>{
      const value=Number(s.fingerprint?.sexualized||0);
      const h=clamp((value/max)*100,2,100);
      const label=new Intl.DateTimeFormat(undefined,{day:"numeric",month:"short"}).format(new Date(s.createdAt));
      return `<div class="bar-wrap" title="${value.toFixed(1)}"><div class="bar" style="height:${h}%"></div><div class="bar-label">${label}</div></div>`;
    }).join("")+'</div>';
  }

  function renderPatternInsight(){
    const el=$("patternInsight");
    const rated=sessions.filter(s=>s.mood!=null).map(s=>({x:Number(s.fingerprint?.sexualized||0),y:s.mood}));
    if(rated.length<5){
      el.textContent="Mood comparison is optional. Feed Drift can learn your feed baseline from automatic samples alone.";
      return;
    }
    const r=pearson(rated);
    if(r==null){
      el.textContent="There is not enough variation in the current mood check-ins to estimate a relationship yet.";
      return;
    }
    const a=Math.abs(r), strength=a>=.65?"strong":a>=.4?"moderate":a>=.2?"weak":"little";
    if(r<-.2) el.textContent=`Personal pattern: your logged data currently shows a ${strength} tendency for higher sexualised-content scores to accompany lower mood (r=${r.toFixed(2)}). This is correlation only, not a diagnosis or causal claim.`;
    else if(r>.2) el.textContent=`Personal pattern: your logged data currently shows a ${strength} tendency for higher sexualised-content scores to accompany higher mood (r=${r.toFixed(2)}). This is correlation only and may change with more data.`;
    else el.textContent=`Personal pattern: there is currently little linear relationship between sexualised-content score and your mood check-ins (r=${r.toFixed(2)}).`;
  }

  function renderHistory(){
    const el=$("history");
    if(!sessions.length){el.innerHTML="";return;}
    el.innerHTML=sessions.slice().reverse().slice(0,10).map(s=>{
      const high=Number(s.highSexualShare||0).toFixed(0);
      const value=Number(s.fingerprint?.sexualized||0).toFixed(1);
      const source=s.source==="automatic"?"Automatic sample":`${s.frameCount||1} AI frame${Number(s.frameCount||1)===1?"":"s"}`;
      return `<div class="history-row"><div><div class="history-date">${fmtDate(s.createdAt)}</div><div class="history-meta">${source}${s.mood?` · mood ${s.mood}/5`:""} · high-sexual ${high}%</div></div><div class="history-score">${value}</div><button class="history-delete" data-delete="${s.id}" aria-label="Delete scan">✕</button></div>`;
    }).join("");

    el.querySelectorAll("[data-delete]").forEach(btn=>btn.addEventListener("click",async()=>{
      const id=btn.dataset.delete;
      sessions=sessions.filter(s=>s.id!==id);
      save();
      render();
      await deleteSessionFromServer(id);
    }));
  }

  const dialog=$("settingsDialog");

  $("settingsBtn").addEventListener("click",()=>{
    $("accessToken").value=settings.accessToken||"";
    $("baselineCount").value=settings.baselineCount;
    $("watchThreshold").value=settings.watchThreshold;
    $("driftThreshold").value=settings.driftThreshold;
    if(!dialog.open)dialog.showModal();
  });

  $("closeSettingsBtn").addEventListener("click",(e)=>{
    e.preventDefault();
    dialog.close();
  });

  $("saveSettingsBtn").addEventListener("click",async(e)=>{
    e.preventDefault();
    settings.accessToken=$("accessToken").value.trim();
    settings.baselineCount=clamp(Number($("baselineCount").value)||7,3,30);
    settings.watchThreshold=clamp(Number($("watchThreshold").value)||5,1,50);
    settings.driftThreshold=clamp(Number($("driftThreshold").value)||10,2,60);
    if(settings.driftThreshold<=settings.watchThreshold)settings.driftThreshold=settings.watchThreshold+1;
    save();
    render();
    dialog.close();
    await syncServerHistory();
  });

  dialog.addEventListener("click",(e)=>{if(e.target===dialog)dialog.close();});

  $("resetBtn").addEventListener("click",async()=>{
    if(!confirm("Delete all Feed Drift scan history from this browser and synced server history?"))return;
    sessions=[];
    save();
    render();
    dialog.close();
    await resetServerHistory();
  });

  $("exportBtn").addEventListener("click",()=>{
    const payload=JSON.stringify({exportedAt:new Date().toISOString(),settings:{...settings,accessToken:"[not exported]"},sessions},null,2);
    const blob=new Blob([payload],{type:"application/json"});
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download=`feed-drift-export-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  });

  if("serviceWorker" in navigator&&location.protocol.startsWith("http")){
    window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
  }

  render();
  syncServerHistory();
})();
