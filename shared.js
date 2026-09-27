// ITLympics Passport — shared logic.
// Used by index.html (attendee Passport), booth.html (staff QR display),
// and testing.html (QA tools). Keeping this in one file means the booth's
// rotating-code math and the passport's validation math can never drift
// apart from each other.

const BOOTHS = [
  {id:'b1', name:'Coding Challenge'},
  {id:'b2', name:'Valorant'},
  {id:'b3', name:'Mobile Legends'},
  {id:'b4', name:'Trivia Night'},
  {id:'b5', name:'Chess'},
  {id:'b6', name:'Cosplay'},
];

// Demo-only secrets. In production these never ship to the client — validation
// happens server-side (e.g. a Supabase Edge Function) at sync time instead.
const BOOTH_SECRETS = {b1:'s-code',b2:'s-valo',b3:'s-mlbb',b4:'s-triv',b5:'s-chess',b6:'s-cos'};

const STORE_KEY = 'itlympics_passport_v1';
const CFG_KEY = 'itlympics_supabase_cfg';
const ROTATION_KEY = 'itlympics_rotation_v1';
const FLAG_KEY = 'itlympics_flags_v1';

// ---- flagged scan attempts (expired / tampered codes) ----
// Written to localStorage first (so flagging never depends on the venue wifi
// being up at that exact moment), then mirrored to Supabase's
// `flagged_scans` table the same way stamps/checkins are. Without the cloud
// mirror, a flag raised on an attendee's own phone only ever existed on that
// phone — staff pulling up Testing > Flagged attempts on a different device
// would never see it. Each flag carries scannedAt (when *this* device saw
// it) and receivedAt (when the cloud confirmed the write), so staff can spot
// a device that's been offline a while.
function loadFlags(){
  try{ const r = localStorage.getItem(FLAG_KEY); if(r) return JSON.parse(r); }catch(e){}
  return [];
}
function saveFlags(flags){ try{ localStorage.setItem(FLAG_KEY, JSON.stringify(flags.slice(0,200))); }catch(e){} }

// entry: {studentId, boothId, boothName, reason, raw}. sb is optional — pass
// the page's Supabase client to attempt an immediate cloud write; omit (or
// pass null/offline) to stay local-only for now and let flushPendingFlags()
// catch it up later.
async function addFlag(entry, sb){
  const flags = loadFlags();
  const flag = {ts: Date.now(), scannedAt: Date.now(), receivedAt: null, synced:false, ...entry};
  flags.unshift(flag);
  saveFlags(flags);
  if(sb) await pushFlag(flag, sb);
  return flags;
}
async function pushFlag(flag, sb){
  if(!sb) return false;
  try{
    const {data, error} = await sb.from('flagged_scans').insert({
      student_id: flag.studentId || null,
      booth_id: flag.boothId || null,
      booth_name: flag.boothName || null,
      reason: flag.reason || null,
      raw: flag.raw || null,
    }).select('id, received_at').single();
    if(error) throw error;
    const flags = loadFlags();
    const mine = flags.find(f=>f.ts===flag.ts);
    if(mine){
      mine.synced = true;
      mine.cloudId = data && data.id;
      mine.receivedAt = (data && data.received_at) ? new Date(data.received_at).getTime() : Date.now();
      saveFlags(flags);
    }
    return true;
  }catch(e){ return false; } // stays unsynced locally; flushPendingFlags() retries it
}
// Retries any flags raised while offline (or while the cloud call failed) —
// call this on reconnect, same spirit as stamps' pendingSync / checkins' queue.
async function flushPendingFlags(sb){
  if(!sb) return;
  for(const f of loadFlags().filter(f=>!f.synced)) await pushFlag(f, sb);
}
function clearFlags(){ try{ localStorage.removeItem(FLAG_KEY); }catch(e){} }

// ---- shared input validation (used by passport registration + skills registration) ----
function validateName(name){
  if(!name || name.length < 2 || !/^[\p{L}][\p{L}\s.'-]*$/u.test(name)) return 'Name looks off — letters only, e.g. "Juan Dela Cruz".';
  return null;
}
function validateStudentId(id){
  if(!/^\d{2}-\d{3,5}$/.test(id)) return 'Student ID format looks wrong — expected YY-NNNN, e.g. "23-0123".';
  return null;
}

// ---- sections list (placeholder — swap for the registrar's real list) ----
// Flat list of "COURSE YEAR-SECTION" strings so filtering is just a substring
// match: typing "BSIT" narrows straight to that course's sections.
const SECTIONS = [
  'BSIT 1-1','BSIT 1-2','BSIT 1-3','BSIT 2-1','BSIT 2-2','BSIT 2-3','BSIT 3-1','BSIT 3-2','BSIT 4-1','BSIT 4-2',
  'BSCS 1-1','BSCS 1-2','BSCS 2-1','BSCS 2-2','BSCS 3-1','BSCS 3-2','BSCS 4-1',
  'BSIS 1-1','BSIS 1-2','BSIS 2-1','BSIS 2-2','BSIS 3-1','BSIS 4-1',
  'BSBA 1-1','BSBA 1-2','BSBA 2-1','BSBA 2-2','BSBA 3-1','BSBA 4-1',
  'BSA 1-1','BSA 2-1','BSA 3-1','BSA 4-1',
  'BEED 1-1','BEED 2-1','BEED 3-1','BEED 4-1',
  'BSED 1-1','BSED 2-1','BSED 3-1','BSED 4-1',
];

// ---- Game Con voting categories (placeholder candidates — swap for the
// real nominee lists once known; Best Booth reuses the existing BOOTHS list
// since those nominees already exist elsewhere in this app) ----
const VOTE_CATEGORIES = [
  {id:'pc-hybrid', title:"People's Choice Award — Hybrid Game", candidates:[
    {id:'h1', name:'Entry 1'}, {id:'h2', name:'Entry 2'}, {id:'h3', name:'Entry 3'}, {id:'h4', name:'Entry 4'},
  ]},
  {id:'pc-digital', title:"People's Choice Award — Digital Game", candidates:[
    {id:'d1', name:'Entry 1'}, {id:'d2', name:'Entry 2'}, {id:'d3', name:'Entry 3'}, {id:'d4', name:'Entry 4'},
  ]},
  {id:'best-banner', title:'Special GAMECON Award — Best Banner', candidates:[
    {id:'bn1', name:'Entry 1'}, {id:'bn2', name:'Entry 2'}, {id:'bn3', name:'Entry 3'}, {id:'bn4', name:'Entry 4'},
  ]},
  {id:'best-booth', title:'Special GAMECON Award — Best Booth', candidates: BOOTHS.map(b=>({id:b.id, name:b.name}))},
];

// Wires a text input + a following <div class="combobox-list"> into a
// type-to-filter picker. onPick(value) fires when an option is chosen.
function initCombobox(inputEl, listEl, options, onPick){
  let activeIdx = -1;
  function render(items){
    listEl.innerHTML = '';
    if(!items.length){ listEl.innerHTML = '<div class="combobox-empty">No matching section</div>'; }
    items.forEach((opt, i)=>{
      const row = document.createElement('div');
      row.className = 'combobox-opt' + (i===activeIdx ? ' active' : '');
      row.textContent = opt;
      row.onmousedown = (e)=>{ e.preventDefault(); pick(opt); };
      listEl.appendChild(row);
    });
  }
  function filtered(){
    const q = inputEl.value.trim().toUpperCase();
    if(!q) return options;
    return options.filter(o=>o.toUpperCase().includes(q));
  }
  function open(){ listEl.classList.add('open'); activeIdx=-1; render(filtered()); }
  function close(){ listEl.classList.remove('open'); }
  function pick(opt){ inputEl.value = opt; close(); onPick(opt); }
  inputEl.addEventListener('focus', open);
  inputEl.addEventListener('input', ()=>{ activeIdx=-1; render(filtered()); listEl.classList.add('open'); onPick(null); });
  inputEl.addEventListener('keydown', (e)=>{
    const items = filtered();
    if(e.key==='ArrowDown'){ e.preventDefault(); activeIdx = Math.min(activeIdx+1, items.length-1); render(items); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); activeIdx = Math.max(activeIdx-1, 0); render(items); }
    else if(e.key==='Enter'){ if(activeIdx>=0 && items[activeIdx]){ e.preventDefault(); pick(items[activeIdx]); } }
    else if(e.key==='Escape'){ close(); }
  });
  document.addEventListener('click', (e)=>{ if(e.target!==inputEl && !listEl.contains(e.target)) close(); });
}

// ---- passport state (registration + stamps) ----
// Each stamp is {scannedAt, receivedAt, notSure} — scannedAt is this
// device's local clock the moment it accepted the code, receivedAt is filled
// in once the cloud write confirms, notSure marks a stamp that only passed
// because of the backward grace period (see validateCode below).
function normalizeStamps(stamps){
  const out = {};
  Object.keys(stamps||{}).forEach(id=>{
    const v = stamps[id];
    out[id] = (v && typeof v === 'object')
      ? {scannedAt: v.scannedAt || Date.now(), receivedAt: v.receivedAt || null, notSure: !!v.notSure}
      : {scannedAt: v || Date.now(), receivedAt: null, notSure: false}; // migrate old plain-timestamp shape
  });
  return out;
}
function loadState(){
  try{
    const r = localStorage.getItem(STORE_KEY);
    if(r){ const s = JSON.parse(r); s.stamps = normalizeStamps(s.stamps); return s; }
  }catch(e){}
  return {name:null, studentId:null, stamps:{}, pendingSync:[], online:navigator.onLine!==false};
}
function saveState(state){ try{ localStorage.setItem(STORE_KEY, JSON.stringify(state)); }catch(e){} }

// ---- Supabase config ----
function loadCfg(){
  try{ const r = localStorage.getItem(CFG_KEY); if(r) return JSON.parse(r); }catch(e){}
  return {url:'', key:''};
}
function saveCfg(cfg){ try{ localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }catch(e){} }
function initSupabase(cfg){
  return (cfg.url && cfg.key && window.supabase) ? window.supabase.createClient(cfg.url, cfg.key) : null;
}

// ---- Supabase Realtime ----
// One channel per table, fired on every insert/update — this is the
// "microupdates" layer (replaces reaching for Pusher): other devices see a
// new stamp/registration land within ~1s, no polling. Needs Replication
// turned on for the table in the Supabase dashboard (Database > Replication)
// — that's a one-time per-table setting, not something the client controls.
function subscribeTable(sb, table, onChange){
  if(!sb) return null;
  return sb.channel('rt-'+table)
    .on('postgres_changes', {event:'*', schema:'public', table}, payload => onChange(payload))
    .subscribe();
}

// ---- rotation interval (set on the booth device, read everywhere else) ----
function loadRotation(){
  try{ const r = localStorage.getItem(ROTATION_KEY); if(r) return Math.max(5, parseInt(r)||30); }catch(e){}
  return 30;
}
function saveRotation(seconds){
  try{ localStorage.setItem(ROTATION_KEY, String(Math.max(5, parseInt(seconds)||30))); }catch(e){}
}

// ---- rotating code: HMAC-SHA256 via Web Crypto, windowed by absolute time ----
async function hmac(secret, msg){
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return Array.from(new Uint8Array(sig)).map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,10);
}
function currentWindow(rotationSeconds, offsetSeconds){
  return Math.floor((Date.now()/1000 + (offsetSeconds||0)) / rotationSeconds);
}
function codeForBooth(boothId, windowId){ return hmac(BOOTH_SECRETS[boothId], boothId+':'+windowId); }

// A code is valid inside its own rotation window, plus a short backward-only
// grace period right after it rolls over — never forward. Concretely, with
// the default 30s rotation and a 5s grace: a code is good for the full 30s
// it's on screen, and then for up to another 5s after the *next* code has
// already replaced it (only if we're still within the first 5s of that new
// window). That makes the effective scan window ~35s, but it's asymmetric —
// nobody can pre-scan a code before its window starts.
//
// This replaces the old `Math.abs(myWindow - windowId) > 1` check, which
// looked like a "±1 window" tolerance but actually accepted the *next*
// window's code too (up to a full rotationSeconds early) and up to a full
// rotationSeconds late — looser, in both directions, than intended.
const GRACE_SECONDS = 5;

async function validateCode(text, rotationSeconds, driftSeconds){
  if(!text || !text.startsWith('BOOTH:')) return {ok:false, reason:'Not a booth code'};
  const parts = text.split(':');
  if(parts.length!==4) return {ok:false, reason:'Malformed code'};
  const [,boothId, windowIdStr, code] = parts;
  const booth = BOOTHS.find(b=>b.id===boothId);
  if(!booth) return {ok:false, reason:'Unknown booth'};
  const windowId = parseInt(windowIdStr, 10);
  if(!Number.isFinite(windowId)) return {ok:false, reason:'Malformed code'};

  const nowSeconds = Date.now()/1000 + (driftSeconds||0);
  const myWindow = Math.floor(nowSeconds / rotationSeconds);
  const secsIntoCurrentWindow = nowSeconds - myWindow*rotationSeconds;

  let notSure = false;
  if(windowId === myWindow){
    // squarely inside the code's own window — nothing uncertain about it
  } else if(windowId === myWindow - 1 && secsIntoCurrentWindow < GRACE_SECONDS){
    // the window just rolled over, and we're still within the grace period —
    // honor the just-expired code, but flag it as not-sure so staff can see
    // it wasn't a clean in-window scan.
    notSure = true;
  } else {
    return {ok:false, reason:'Expired code (outside sync window)', booth};
  }

  const expected = await codeForBooth(boothId, windowId);
  if(expected !== code) return {ok:false, reason:'Invalid code (signature mismatch)', booth};
  return {ok:true, booth, notSure};
}
