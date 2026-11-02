// Live "who's on the call" presence for the crew room. Public, read-only.
//
// GET /api/presence -> { generatedAt, agents: { <crew id>: {
//     lastSeen (ISO | null), project, summary, claim, state } } }
//
// Everything here is derived from the PUBLIC ai-coms board (handoff filenames,
// BOARD.md "Active claims" + "Latest handoffs" lines), so no Face ID: it
// exposes nothing a visitor can't read on GitHub. The server token is used only
// for rate limits; results are cached so GitHub sees at most ~3 reads a minute.
// Same-origin GET only. Never writes. Never returns env values.
import { config, json, makeLimiter } from './handlers.mjs';
import { parseHandoffName } from './status.mjs';

const API = 'https://api.github.com';
const CACHE_MS = 20e3;
const limitPresence = makeLimiter(120, 60e3);
let cache = null; // { at, body }

// Presence windows (ms). "live" is the green ring.
export const LIVE_MS = 15 * 60e3;
export const ACTIVE_MS = 3 * 3600e3;
export const IDLE_MS = 24 * 3600e3;

// Handoff/board agent tag -> crew.json id. Unknown tags are ignored.
export function crewIdFor(tag) {
  const t = String(tag || '').trim().toLowerCase();
  if (!t) return null;
  if (/^(muse-)?blue/.test(t)) return 'muse-blue';
  if (t.startsWith('paperclip') || t.includes('paperclip-vm')) return 'claude-code (paperclip-vm)';
  if (['claude', 'claude-code', 'codex', 'astra', 'chatgpt', 'muse', 'grok'].includes(t)) return t;
  return null;
}

// 'YYYY-MM-DD', 'HH:MM' wall clock in America/New_York -> Date (DST-aware).
export function etToDate(day, hhmm) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || '');
  const h = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  if (!m || !h) return null;
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  });
  const want = `${m[2]}/${m[3]}/${m[1]}, ${h[1].padStart(2, '0')}:${h[2]}`;
  for (const offset of [4, 5]) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +h[1] + offset, +h[2]));
    if (fmt.format(d) === want) return d;
  }
  return null;
}

const clean = (s, max) => {
  const out = String(s || '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim();
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
};

// Section body of BOARD.md under a "## ... <title>" heading.
function section(board, title) {
  const lines = board.split('\n');
  const start = lines.findIndex((l) => l.startsWith('## ') && l.includes(title));
  if (start < 0) return [];
  const out = [];
  for (const l of lines.slice(start + 1)) { if (l.startsWith('## ')) break; out.push(l); }
  return out;
}

// Active claims: "- [agent] project · what · started YYYY-MM-DD HH:MM ET".
// Struck-through (released) and undated claims are skipped. Newest per agent wins.
export function parseClaims(board) {
  const claims = {};
  for (const raw of section(String(board || ''), 'Active claims')) {
    const m = /^- \[([^\]→>]+)\]\s*([^·]+)·(.*)$/.exec(raw.trim());
    if (!m) continue;
    const id = crewIdFor(m[1]);
    if (!id) continue;
    const started = /started (\d{4}-\d{2}-\d{2}) (\d{1,2}:\d{2}) ET/.exec(raw);
    const at = started ? etToDate(started[1], started[2]) : null;
    if (!at) continue; // undated claims can't be judged fresh or stale
    const prev = claims[id];
    if (prev && prev.at >= at) continue;
    claims[id] = { project: clean(m[2], 40), text: clean(m[3].replace(/·\s*started.*$/, ''), 120), at };
  }
  return claims;
}

// Latest handoffs: "- VERIFIED · 2026-11-01 22:55 ET · agent · project · summary".
export function parseLatest(board) {
  const out = {};
  for (const raw of section(String(board || ''), 'Latest handoffs')) {
    const parts = raw.replace(/^-\s*/, '').split(' · ');
    if (parts.length < 4 || !raw.trim().startsWith('- ')) continue;
    const when = /(\d{4}-\d{2}-\d{2}) ~?(\d{1,2}:\d{2}) ET/.exec(parts[1] || '');
    const id = crewIdFor(parts[2]);
    if (!when || !id || out[id]) continue;
    out[id] = { at: etToDate(when[1], when[2]), project: clean(parts[3], 40), summary: clean(parts.slice(4).join(' · '), 160) };
  }
  return out;
}

export function stateFor(lastSeen, hasClaim, now) {
  if (!lastSeen) return hasClaim ? 'active' : 'away';
  const age = now - lastSeen.getTime();
  if (age <= LIVE_MS) return 'live';
  if (age <= ACTIVE_MS || (hasClaim && age <= IDLE_MS)) return 'active';
  if (age <= IDLE_MS) return 'idle';
  return 'away';
}

// Pure: handoff filenames + BOARD.md text -> presence map.
export function buildPresence(names, board, now) {
  const agents = {};
  const seen = (id) => (agents[id] ||= { lastSeen: null, project: null, summary: null, claim: null });
  for (const name of names || []) {
    const h = parseHandoffName(name);
    const id = h && crewIdFor(h.agent);
    if (!id) continue;
    const [day, time] = h.when.split(' ');
    const at = etToDate(day, time);
    if (!at || at.getTime() > now + 5 * 60e3) continue;
    const a = seen(id);
    if (!a.lastSeen || at > a.lastSeen) { a.lastSeen = at; a.project = clean(h.project, 40); }
  }
  for (const [id, l] of Object.entries(parseLatest(board))) {
    const a = seen(id);
    if (l.at && (!a.lastSeen || l.at >= a.lastSeen)) { a.lastSeen = l.at; a.project = l.project; }
    if (!a.summary) a.summary = l.summary;
  }
  for (const [id, c] of Object.entries(parseClaims(board))) {
    const a = seen(id);
    if (now - c.at.getTime() > IDLE_MS) continue; // stale claim
    a.claim = `${c.project} · ${c.text}`;
    if (!a.lastSeen || c.at > a.lastSeen) { a.lastSeen = c.at; a.project = c.project; }
  }
  for (const a of Object.values(agents)) {
    a.state = stateFor(a.lastSeen, Boolean(a.claim), now);
    a.lastSeen = a.lastSeen ? a.lastSeen.toISOString() : null;
  }
  return { generatedAt: new Date(now).toISOString(), agents };
}

async function ghGet(fetchImpl, token, path, accept = 'application/vnd.github+json') {
  const res = await fetchImpl(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'coms-pwa' }
  });
  if (!res.ok) return null;
  return accept.endsWith('raw') ? res.text() : res.json();
}

export function resetPresenceCache() { cache = null; }

export async function handlePresence(request, env, deps = {}) {
  const cfg = config(env);
  const now = deps.now ?? Date.now();
  if (request.method !== 'GET') return json(405, { error: 'GET only' });
  const origin = request.headers.get('origin');
  if (origin && origin !== cfg.origin) return json(403, { error: 'wrong origin' });
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return json(403, { error: 'cross-site request refused' });
  if (cache && now - cache.at < CACHE_MS) return json(200, cache.body);
  if (!cfg.token) return json(503, { error: 'Presence is not set up yet (GITHUB_TOKEN)' });
  if (!(deps.limit ?? limitPresence)(now)) return json(429, { error: 'busy; try again in a minute' });
  const fetchImpl = deps.fetchImpl ?? fetch;
  let names = [];
  let board = '';
  try {
    const list = await ghGet(fetchImpl, cfg.token, `/repos/${cfg.repo}/contents/handoffs`);
    if (Array.isArray(list)) names = list.filter((e) => e && e.type === 'file').map((e) => e.name);
  } catch { /* fail soft */ }
  try {
    board = (await ghGet(fetchImpl, cfg.token, `/repos/${cfg.repo}/contents/BOARD.md`, 'application/vnd.github.raw')) || '';
  } catch { /* fail soft */ }
  if (!names.length && !board) return json(502, { error: 'board unreachable' });
  const body = buildPresence(names, board, now);
  cache = { at: now, body };
  return json(200, body);
}
