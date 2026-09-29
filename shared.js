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
const GEOFENCE_KEY = 'itlympics_geofence_v1';

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
function validatePin(pin){
  // Supabase Auth's minimum password length is 6 (its default), so a PIN is 6+ digits.
  if(!/^\d{6,12}$/.test(pin||'')) return 'PIN must be 6–12 digits.';
  return null;
}
function validateStudentId(id){
  if(!/^\d{2}-\d{3,5}$/.test(id)) return 'Student ID format looks wrong — expected YY-NNNN, e.g. "23-0123".';
  return null;
}

// ---- sections list ----
// Lives in the `sections` table in Supabase (see Testing page SQL) so staff
// can add, rename or remove sections from the dashboard without a redeploy.
// SECTIONS_FALLBACK below is only used when there's no cloud connection at
// all, or the table hasn't been created/seeded yet — same "graceful
// degrade to local-only" pattern as everything else in this app.
const SECTIONS_FALLBACK = [
  'BSIT 1-1','BSIT 1-2','BSIT 1-3','BSIT 2-1','BSIT 2-2','BSIT 2-3','BSIT 3-1','BSIT 3-2','BSIT 4-1','BSIT 4-2',
  'BSCS 1-1','BSCS 1-2','BSCS 2-1','BSCS 2-2','BSCS 3-1','BSCS 3-2','BSCS 4-1',
  'BSIS 1-1','BSIS 1-2','BSIS 2-1','BSIS 2-2','BSIS 3-1','BSIS 4-1',
  'BSBA 1-1','BSBA 1-2','BSBA 2-1','BSBA 2-2','BSBA 3-1','BSBA 4-1',
  'BSA 1-1','BSA 2-1','BSA 3-1','BSA 4-1',
  'BEED 1-1','BEED 2-1','BEED 3-1','BEED 4-1',
  'BSED 1-1','BSED 2-1','BSED 3-1','BSED 4-1',
];
// Returns a flat array of "COURSE YEAR-SECTION" strings, same shape as the
// fallback above, so callers don't care where the list came from.
async function loadSections(sb){
  if(!sb) return SECTIONS_FALLBACK;
  try{
    const {data, error} = await sb.from('sections').select('name').order('name');
    if(error) throw error;
    if(!data || !data.length) return SECTIONS_FALLBACK;
    return data.map(r=>r.name);
  }catch(e){ return SECTIONS_FALLBACK; }
}

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

// First token of a "COURSE YEAR-SECTION" string, e.g. "BSIT 2-1" -> "BSIT".
// Shared by Testing's live feed and the Dashboard's section breakdown so
// grouping-by-course can't drift between the two.
function courseOf(section){ return (section||'').split(' ')[0] || 'Unknown'; }

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
      ? {scannedAt: v.scannedAt || Date.now(), receivedAt: v.receivedAt || null, notSure: !!v.notSure, pendingVerify: !!v.pendingVerify}
      : {scannedAt: v || Date.now(), receivedAt: null, notSure: false, pendingVerify: false}; // migrate old plain-timestamp shape
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
const DEFAULT_SB_URL = 'https://pryiiaqubqdrcavxszax.supabase.co';
const DEFAULT_SB_KEY = 'sb_publishable_-S7knesEIWoMVYUdkiEvCg_4KMgf55-';
// pin: the staff-only PIN gating get_booth_seed (see below) — blank by
// default, only ever set manually via the Booth/Testing Configure screen,
// never baked in as a default like the URL/key are.
function loadCfg(){
  const defaults = {url:DEFAULT_SB_URL, key:DEFAULT_SB_KEY, pin:''};
  try{ const r = localStorage.getItem(CFG_KEY); if(r) return Object.assign(defaults, JSON.parse(r)); }catch(e){}
  return defaults;
}
function saveCfg(cfg){ try{ localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }catch(e){} }
let _sbClient = null, _sbClientKey = null;
function initSupabase(cfg){
  if(!(cfg.url && cfg.key && window.supabase)) return null;
  const k = cfg.url + '|' + cfg.key;
  if(_sbClient && _sbClientKey === k) return _sbClient; // one client (one auth instance) per page
  _sbClient = window.supabase.createClient(cfg.url, cfg.key); _sbClientKey = k;
  return _sbClient;
}

// ---- auth: Student ID + PIN on real Supabase Auth accounts ----
// Every person — attendee, staff, admin — is a real Supabase Auth user, so
// PINs are hashed by Supabase and sessions are signed JWTs. There's no email
// anywhere in this app: we synthesize one from the Student ID (Auth needs
// *some* unique identifier) and the PIN is the password. What a person may
// DO is decided by the `role` on their `profiles` row and enforced by RLS in
// the database (see the RBAC SQL on the Testing page) — the page-level gating
// below only decides what to SHOW, so tampering with it in devtools can't
// grant real access.
//
// One-time Supabase settings (Authentication > Providers > Email):
//  - turn OFF "Confirm email" (these addresses can't receive mail)
//  - minimum password length 6 or lower (Auth's default is 6)
// If signup ever fails with "email address is invalid", change AUTH_DOMAIN.
const AUTH_DOMAIN = 'itlympics.local';
const ROLE_RANK = {user:1, staff:2, admin:3};
function roleMeets(role, minRole){ return (ROLE_RANK[role]||0) >= (ROLE_RANK[minRole]||0); }
function studentIdToEmail(studentId){ return studentId.trim().toLowerCase().replace(/\s+/g,'') + '@' + AUTH_DOMAIN; }

// Does this Student ID already have an account? Asked BEFORE any PIN field
// is shown, so the login page can offer "enter your PIN" vs "create one".
// (account_exists is a security-definer function, callable while logged out.)
async function accountExists(sb, studentId){
  if(!sb) return {reason:"Can't check accounts — cloud backend not connected."};
  try{
    const {data, error} = await sb.rpc('account_exists', {p_student_id: studentId.trim()});
    if(error) throw error;
    return {exists: !!data};
  }catch(e){ return {reason: "Couldn't check that ID: " + e.message + " (has the RBAC SQL been run?)"}; }
}
async function signInWithIdPin(sb, studentId, pin){
  const {error} = await sb.auth.signInWithPassword({email: studentIdToEmail(studentId), password: pin});
  if(!error) return {ok:true};
  return {ok:false, reason: /invalid login credentials/i.test(error.message) ? 'Incorrect PIN.' : error.message};
}
async function signUpWithIdPin(sb, studentId, name, pin){
  const {data, error} = await sb.auth.signUp({
    email: studentIdToEmail(studentId), password: pin,
    options: {data: {student_id: studentId.trim(), name: (name||'').trim()}}
  });
  if(error){
    if(/already registered|already been registered/i.test(error.message)) return {ok:false, reason:'That Student ID already has a login — go back and enter your PIN.'};
    return {ok:false, reason: error.message};
  }
  if(!data.session) return {ok:false, reason:'Account created but not logged in — turn OFF "Confirm email" in Supabase (Authentication > Providers > Email), then log in.'};
  return {ok:true};
}

// The last verified profile is cached so a device that's gone offline (venue
// wifi drops) isn't locked out of pages meant to keep working offline — the
// Entrance queue, the cached-seed Booth Display, the offline Passport. This
// only affects what the UI shows; RLS checks the real session on every write.
const PROFILE_KEY = 'itlympics_profile_v1';
function loadCachedProfile(){ try{ const r = localStorage.getItem(PROFILE_KEY); if(r) return JSON.parse(r); }catch(e){} return null; }
function saveCachedProfile(p){ try{ localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); }catch(e){} }
async function authSignOut(sb){
  try{ localStorage.removeItem(PROFILE_KEY); }catch(e){}
  try{ if(sb) await sb.auth.signOut(); }catch(e){}
  // If the sign-out call couldn't reach the server (offline), make sure the
  // stored session is gone anyway rather than leaving this device logged in.
  try{ Object.keys(localStorage).filter(k=>/^sb-.*-auth-token$/.test(k)).forEach(k=>localStorage.removeItem(k)); }catch(e){}
}
// {student_id, name, role} for the current session, or null. Falls back to
// the cached profile only when the failure was the NETWORK (offline / fetch
// failed) — a real database answer, like "no such profile", is never overridden.
async function fetchMyProfile(sb){
  if(!sb) return null;
  try{
    const {data:{user}} = await sb.auth.getUser();
    if(!user) return null;
    const {data, error} = await sb.from('profiles').select('student_id, name, role').eq('user_id', user.id).single();
    if(error) throw error;
    saveCachedProfile(data);
    return data;
  }catch(e){
    const networkFailure = navigator.onLine===false || !(e && (e.code || e.status));
    return networkFailure ? loadCachedProfile() : null;
  }
}

// ---- roles: ONE login for everything, pages unlock by role ----
// user < staff < admin, each role gets everything below it. login.html is the
// only place anyone logs in or registers; every other page is guarded by the
// block at the bottom of this file. Testing is staff+: the destructive tools
// on it are admin-only, enforced by the database (RLS), not just hidden.
const PAGE_ROLE = {
  'index.html':'user', 'skills.html':'user', 'vote.html':'user',
  'booth.html':'staff', 'entrance.html':'staff', 'dashboard.html':'staff', 'testing.html':'staff'
};
const ROLE_HOME = {user:'index.html', staff:'dashboard.html', admin:'dashboard.html'};
function currentPage(){ return location.pathname.split('/').pop() || 'index.html'; }
function canOpen(role, page){ const need = PAGE_ROLE[page]; return !!need && roleMeets(role, need); }
function goToLogin(page, denied){
  document.documentElement.style.display = 'none'; // no flash of a page you can't use
  location.replace('login.html?next=' + encodeURIComponent(page) + (denied ? '&denied=1' : ''));
}
async function signOut(){
  const st = loadState();
  if(st.pendingSync && st.pendingSync.length &&
     !confirm(`${st.pendingSync.length} stamp(s) on this device haven't synced yet. Logging out now will lose them. Log out anyway?`)) return;
  await authSignOut(initSupabase(loadCfg()));
  saveState({name:null, studentId:null, stamps:{}, pendingSync:[], online:st.online});
  location.replace('login.html');
}
function applyRoleNav(profile){
  const nav = document.querySelector('.pagenav'); if(!nav) return;
  nav.querySelectorAll('a').forEach(a=>{
    const page = (a.getAttribute('href')||'').split('/').pop();
    if(PAGE_ROLE[page] && !canOpen(profile.role, page)) a.remove();
  });
  const out = document.createElement('a');
  out.href = '#'; out.textContent = 'Log out'; out.style.marginLeft = 'auto';
  out.onclick = e => { e.preventDefault(); signOut(); };
  nav.appendChild(out);
}

// Resolves to the verified profile once this page's guard passes (never, if
// the guard redirected away). Pages hook their startup onto this.
let authReady = Promise.resolve(null);
// Kept so pages can say "start once a user with at least minRole is in" —
// the guard has already enforced the page's own minimum by then.
function mountAuthGate(sb, opts){
  opts = opts || {};
  return authReady.then(profile=>{
    if(profile && roleMeets(profile.role, opts.minRole||'user') && opts.onReady) opts.onReady(profile);
  });
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

// ---- rotating code: generated and verified server-side via Supabase RPC,
// with a cached-seed fallback for offline booth devices ----
// The per-booth secrets and the HMAC/grace-period math used to live here on
// the client (see git history) — that meant anyone reading this public repo
// could compute a valid code for any booth without ever showing up. They now
// live only in the `booth_secrets` table, readable by nobody directly, and
// the Postgres functions below do the same HMAC + grace-period check the old
// client code did, but on the server. See the SQL schema (Testing page) for
// the exact logic and the grace-period rationale.
//
// Offline fallback: `get_booth_seed` (staff-PIN gated — see the SQL) lets a
// *booth* device pull its own booth's secret while it has a connection and
// cache it locally, so it can keep computing valid rotating codes with the
// same HMAC math if venue wifi drops. This only ever caches the one booth
// that device is displaying for, and only a device that knows the staff PIN
// can fetch it — but be clear-eyed that anyone who extracts that PIN (or a
// cached seed off a booth device) could forge codes for that booth without
// showing up, same risk as the original client-side version, just scoped to
// one booth instead of all six. There's no way around that and still have
// codes generate with zero connection.
const SEED_KEY = 'itlympics_booth_seeds_v1';
function loadSeeds(){
  try{ const r = localStorage.getItem(SEED_KEY); if(r) return JSON.parse(r); }catch(e){}
  return {};
}
function loadBoothSeed(boothId){ const s = loadSeeds()[boothId]; return s ? s.secret : null; }
function loadBoothSeedInfo(boothId){ return loadSeeds()[boothId] || null; } // {secret, fetchedAt}
function saveBoothSeed(boothId, secret){
  const seeds = loadSeeds();
  seeds[boothId] = {secret, fetchedAt: Date.now()};
  try{ localStorage.setItem(SEED_KEY, JSON.stringify(seeds)); }catch(e){}
}
// staffPin: no longer used (kept as an accepted-but-ignored 3rd arg so old
// call sites don't break) — access is now checked server-side against the
// caller's real logged-in role (see get_booth_seed's SQL), same as
// everything else post-RBAC.
async function fetchBoothSeed(sb, boothId){
  if(!sb) return null;
  try{
    const {data, error} = await sb.rpc('get_booth_seed', {p_booth_id: boothId});
    if(error) throw error;
    if(data){ saveBoothSeed(boothId, data); return data; }
    return null; // not staff/admin, or booth_secrets has no row for this booth
  }catch(e){ console.error('get_booth_seed failed', e); return null; }
}
function boothWindowId(rotationSeconds, atMs){ return Math.floor((atMs===undefined?Date.now():atMs)/1000 / rotationSeconds); }
async function hmacSha256Hex(secret, message){
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
// Mirrors generate_booth_code's SQL exactly: same window math, same
// "hmac(booth_id:window, secret) -> first 10 hex chars" shape.
async function computeBoothCodeLocal(boothId, secret, rotationSeconds){
  const windowId = boothWindowId(rotationSeconds);
  const hex = await hmacSha256Hex(secret, boothId+':'+windowId);
  return 'BOOTH:'+boothId+':'+windowId+':'+hex.slice(0,10);
}
// Returns {code, offline}. Tries the live RPC first (and, on success,
// opportunistically refreshes the cached seed for next time offline). Falls
// back to a locally-computed code from the last cached seed when there's no
// connection, the RPC fails, or no sb at all — code is null if that fails
// too (never online yet, or no staff PIN was ever entered on this device).
async function generateBoothCode(sb, boothId, rotationSeconds){
  if(sb){
    try{
      const {data, error} = await sb.rpc('generate_booth_code', {p_booth_id: boothId, p_rotation_seconds: rotationSeconds});
      if(error) throw error;
      if(data){ fetchBoothSeed(sb, boothId); return {code:data, offline:false}; }
    }catch(e){ console.error('generate_booth_code failed, falling back to cached seed', e); }
  }
  const secret = loadBoothSeed(boothId);
  if(!secret) return {code:null, offline:true};
  return {code: await computeBoothCodeLocal(boothId, secret, rotationSeconds), offline:true};
}
// Returns {ok, reason, notSure, booth, offline?}. `offline:true` marks the
// two cases where we simply couldn't reach the server to check the
// signature (no client, or the RPC call itself failed) — as opposed to a
// case where the server *did* check it and said no. Callers (e.g.
// index.html's handleScannedText) can treat `offline` results differently
// from a genuine rejection: a well-formed code for a real booth, scanned
// while offline, is safe to accept-and-queue rather than block, since it
// can't be told apart from a real one without a connection anyway.
async function validateBoothCode(sb, text, rotationSeconds, lat, lng){
  if(!text || !text.startsWith('BOOTH:')) return {ok:false, reason:'Not a booth code'};
  const parts = text.split(':');
  const booth = parts.length===4 ? BOOTHS.find(b=>b.id===parts[1]) : undefined;
  if(!sb) return {ok:false, offline:true, reason:"Can't verify right now — cloud backend not connected", booth};
  let data, error;
  try{ ({data, error} = await sb.rpc('validate_booth_code', {p_code: text, p_rotation_seconds: rotationSeconds, p_lat: lat ?? null, p_lng: lng ?? null})); }
  catch(e){ error = e; }
  if(error){
    console.error('validate_booth_code failed', error);
    return {ok:false, offline:true, reason:'Verification failed — no connection', booth};
  }
  const row = Array.isArray(data) ? data[0] : data;
  if(!row) return {ok:false, reason:'Verification failed — try again', booth};
  const rowBooth = row.booth_id ? BOOTHS.find(b=>b.id===row.booth_id) : booth;
  return {ok:row.ok, reason:row.reason, notSure:row.not_sure, booth:rowBooth};
}

// ---- geofence (campus-only scanning) ----
// Lives in the public `event_settings` table (not app_config — that one's
// locked down for the staff PIN, see get_booth_seed) so every attendee's
// phone can read it directly with no gate: enabled/lat/lng/radius aren't
// secrets, and index.html needs to check them before every scan. Turning
// this on/off is a single row update from the Testing page's Geofence
// panel — no redeploy, same pattern as the rotation interval — specifically
// so it can ship OFF while the app's still being built/tested away from
// campus, then get flipped on once staff are actually on-site.
// Cached locally (like the booth seed) so a device that's gone offline
// keeps enforcing whatever it last saw online rather than silently
// reverting to "off".
const GEOFENCE_DEFAULT = {enabled:false, lat:14.6940301, lng:120.969399, radiusM:250};
function loadGeofenceCfg(){
  try{ const r = localStorage.getItem(GEOFENCE_KEY); if(r) return Object.assign({}, GEOFENCE_DEFAULT, JSON.parse(r)); }catch(e){}
  return GEOFENCE_DEFAULT;
}
function saveGeofenceCfg(cfg){ try{ localStorage.setItem(GEOFENCE_KEY, JSON.stringify(cfg)); }catch(e){} }
async function fetchGeofenceCfg(sb){
  if(!sb) return loadGeofenceCfg();
  try{
    const {data, error} = await sb.from('event_settings').select('key, value')
      .in('key', ['geofence_enabled','geofence_lat','geofence_lng','geofence_radius_m']);
    if(error) throw error;
    const map = {}; (data||[]).forEach(r=>map[r.key]=r.value);
    const cfg = {
      enabled: map.geofence_enabled === 'true',
      lat: parseFloat(map.geofence_lat),
      lng: parseFloat(map.geofence_lng),
      radiusM: parseFloat(map.geofence_radius_m),
    };
    if(Number.isNaN(cfg.lat) || Number.isNaN(cfg.lng) || Number.isNaN(cfg.radiusM)) return loadGeofenceCfg();
    saveGeofenceCfg(cfg);
    return cfg;
  }catch(e){ console.error('fetchGeofenceCfg failed, using cached value', e); return loadGeofenceCfg(); }
}
// Writing goes through this RPC instead of a direct table write — it's
// admin-only server-side (see set_event_setting's SQL), checked against
// the caller's real logged-in role, not a shared PIN.
async function setEventSetting(sb, key, value){
  if(!sb) return false;
  try{
    const {data, error} = await sb.rpc('set_event_setting', {p_key:key, p_value:String(value)});
    if(error) throw error;
    return !!data;
  }catch(e){ console.error('set_event_setting failed', e); return false; }
}
// Admin-only (checked server-side, same pattern as set_event_setting).
async function setUserRole(sb, studentId, role){
  if(!sb) return false;
  try{
    const {data, error} = await sb.rpc('set_user_role', {p_student_id: studentId, p_role: role});
    if(error) throw error;
    return !!data;
  }catch(e){ console.error('set_user_role failed', e); return false; }
}
function haversineMeters(lat1, lng1, lat2, lng2){
  const R = 6371000, toRad = d=>d*Math.PI/180;
  const dLat = toRad(lat2-lat1), dLng = toRad(lng2-lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}
function getPosition(timeoutMs){
  return new Promise((resolve, reject)=>{
    if(!navigator.geolocation){ reject(new Error('Geolocation not supported on this device/browser')); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve(pos.coords),
      err => reject(err),
      {enableHighAccuracy:true, timeout: timeoutMs||10000, maximumAge:15000}
    );
  });
}
// Returns {ok, skipped, distanceM?, lat?, lng?, reason?}. skipped:true means
// the geofence is off — ok:true in that case means "not checked", not
// "confirmed on campus". Works fully offline: GPS itself needs no
// connection, only the enabled/lat/lng/radius values (cached) do.
async function checkGeofence(geoCfg){
  if(!geoCfg || !geoCfg.enabled) return {ok:true, skipped:true};
  let coords;
  try{ coords = await getPosition(); }
  catch(e){ return {ok:false, skipped:false, reason:'Location unavailable — enable location access for this site and try again'}; }
  const distanceM = haversineMeters(coords.latitude, coords.longitude, geoCfg.lat, geoCfg.lng);
  if(distanceM > geoCfg.radiusM){
    return {ok:false, skipped:false, distanceM, reason:`You're about ${Math.round(distanceM)}m from campus — get within ${geoCfg.radiusM}m to scan`};
  }
  return {ok:true, skipped:false, distanceM, lat:coords.latitude, lng:coords.longitude};
}

// ---- page guard: runs as soon as this file loads, before the page's own script ----
(function pageGuard(){
  const page = currentPage();
  const need = PAGE_ROLE[page];
  if(!need) return; // login.html etc. have no requirement
  document.documentElement.style.visibility = 'hidden'; // hidden until the check passes
  authReady = (async ()=>{
    const sb = initSupabase(loadCfg());
    let profile = null;
    if(sb){
      let session = null;
      try{ ({data:{session}} = await sb.auth.getSession()); }catch(e){}
      if(session) profile = await fetchMyProfile(sb);
      else if(navigator.onLine===false) profile = loadCachedProfile();
    } else if(navigator.onLine===false){ profile = loadCachedProfile(); }
    if(!profile){ goToLogin(page, false); return new Promise(()=>{}); }
    if(!roleMeets(profile.role, need)){ goToLogin(page, true); return new Promise(()=>{}); }
    document.documentElement.style.visibility = '';
    applyRoleNav(profile);
    return profile;
  })();
})();
