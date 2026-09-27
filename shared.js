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
// because of the backward grace period (see validateBoothCode below).
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
// Every attendee's phone is a fresh, unrelated browser — there's no shared
// backend to auto-discover. So "automatic" here means: bake the event's own
// project URL/anon key in as defaults below, and every page connects on
// load with zero setup. The Configure screen still exists as a manual
// override (e.g. pointing at a staging project), and anything saved there
// wins over these defaults.
const DEFAULT_SB_URL = 'https://supabase.com/dashboard/project/pryiiaqubqdrcavxszax';
const DEFAULT_SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByeWlpYXF1YnFkcmNhdnhzemF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0OTk1OTAsImV4cCI6MjEwNjA3NTU5MH0.EZT17S4XIo9-T9afJ7kNOpoaqhY-uTcfQQXTj9BvFIk';
function loadCfg(){
  try{ const r = localStorage.getItem(CFG_KEY); if(r) return JSON.parse(r); }catch(e){}
  return {url:DEFAULT_SB_URL, key:DEFAULT_SB_KEY};
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

// ---- rotating code: generated and verified server-side via Supabase RPC ----
// The per-booth secrets and the HMAC/grace-period math used to live here on
// the client (see git history) — that meant anyone reading this public repo
// could compute a valid code for any booth without ever showing up. They now
// live only in the `booth_secrets` table, readable by nobody, and the two
// Postgres functions below (`generate_booth_code`, `validate_booth_code`) do
// the same HMAC + grace-period check the old client code did, but on the
// server. See the SQL schema (Testing page) for the exact logic and the
// grace-period rationale.
//
// Trade-off: unlike the rest of this app, generating and validating a booth
// code now requires a live Supabase connection — there's no local-only
// fallback for this one piece. Booth devices are expected to stay on venue
// wifi; if an attendee's phone is offline when they scan, the scan simply
// can't be verified until they're back online.
async function generateBoothCode(sb, boothId, rotationSeconds){
  if(!sb) return null;
  const {data, error} = await sb.rpc('generate_booth_code', {p_booth_id: boothId, p_rotation_seconds: rotationSeconds});
  if(error){ console.error('generate_booth_code failed', error); return null; }
  return data;
}
async function validateBoothCode(sb, text, rotationSeconds){
  if(!text || !text.startsWith('BOOTH:')) return {ok:false, reason:'Not a booth code'};
  if(!sb) return {ok:false, reason:"Can't verify right now — cloud backend not connected"};
  const {data, error} = await sb.rpc('validate_booth_code', {p_code: text, p_rotation_seconds: rotationSeconds});
  if(error){ console.error('validate_booth_code failed', error); return {ok:false, reason:'Verification failed — try again'}; }
  const row = Array.isArray(data) ? data[0] : data;
  if(!row) return {ok:false, reason:'Verification failed — try again'};
  const booth = row.booth_id ? BOOTHS.find(b=>b.id===row.booth_id) : undefined;
  return {ok:row.ok, reason:row.reason, notSure:row.not_sure, booth};
}
