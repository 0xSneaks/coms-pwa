// Read-only "Crew status" for the owner. Web-standard Request -> Response,
// mirroring lib/handlers.mjs (its exported config/json/makeLimiter are reused;
// the request guard below mirrors the private one there).
//
// POST /api/status  {action:"options"}            -> {options, token}
//                   {action:"view", token, ...}   -> board digest (below)
//
// The unlock is the same owner passkey as "Send to crew" (Face ID), but this
// endpoint only ever READS the board repo (default 0xSneaks/ai-coms): the
// latest order file, the latest handoff filename, and BOARD.md blocker /
// [sneaks → all] lines. Individual GitHub reads fail soft (null / []) so a
// partial board still answers; only config and Face ID failures are hard.
//
// Digest: { lastOrder: {name, title, kind, status} | null,
//           latestHandoff: {name, when, agent, project} | null,
//           blockers: [string], boardLine: string | null,
//           rollCall: {line, checked: [agent id]} | null }
//
// Bodies are never logged. Errors never include env values.
import {
  generateAuthenticationOptions, verifyAuthenticationResponse
} from '@simplewebauthn/server';
import { signToken, verifyToken } from './challenge-token.mjs';
import { config, json, makeLimiter } from './handlers.mjs';

const MAX_BODY = 16 * 1024;
const API = 'https://api.github.com';
const limitStatus = makeLimiter(10, 10 * 60e3);

// Same-origin JSON POST only; no CORS is ever answered. (Mirror of the
// private guard in lib/handlers.mjs — keep the two in step.)
async function readJson(request, cfg) {
  if (request.method !== 'POST') return { error: json(405, { error: 'POST only' }) };
  if (request.headers.get('origin') !== cfg.origin) return { error: json(403, { error: 'wrong origin' }) };
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return { error: json(403, { error: 'cross-site request refused' }) };
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
    return { error: json(415, { error: 'send JSON' }) };
  }
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY) return { error: json(413, { error: 'body too large' }) };
  const raw = await readBounded(request, MAX_BODY);
  if (raw === null) return { error: json(413, { error: 'body too large' }) };
  try {
    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return { body };
  } catch { return { error: json(400, { error: 'bad JSON' }) }; }
}

// Read at most `max` bytes; null if the body is longer (stops reading early).
async function readBounded(request, max) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

// One GitHub contents GET, same headers as lib/order.mjs. -> {status, json}
async function ghGet(fetchImpl, token, path) {
  const res = await fetchImpl(`${API}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'coms-pwa'
    }
  });
  let body = null;
  try { body = await res.json(); } catch { /* empty body */ }
  return { status: res.status, json: body };
}

// Lexicographically greatest .md filename in a contents directory, or null.
async function latestName(fetchImpl, token, repo, dir) {
  const { status, json: list } = await ghGet(fetchImpl, token, `/repos/${repo}/contents/${dir}`);
  if (status !== 200 || !Array.isArray(list)) return null;
  const names = list
    .filter((e) => e && typeof e.name === 'string' && e.name.endsWith('.md'))
    .map((e) => e.name)
    .sort();
  return names.length ? names[names.length - 1] : null;
}

async function readFile(fetchImpl, token, repo, path) {
  const { status, json: file } = await ghGet(fetchImpl, token, `/repos/${repo}/contents/${path}`);
  if (status !== 200 || typeof file?.content !== 'string') return null;
  return Buffer.from(file.content.replace(/\s/g, ''), 'base64').toString('utf8');
}

// Order file -> { title, kind, status }. Title is the "# ..." heading;
// kind/status come from the "**Kind:**" / "**Status:**" fields buildOrder
// writes. Missing fields come back null, never a throw.
export function parseOrderFile(text) {
  if (typeof text !== 'string') return null;
  const lines = text.split('\n');
  const heading = lines.find((l) => l.startsWith('# ')) ?? '';
  const field = (label) => {
    const m = text.match(new RegExp(`\\*\\*${label}:\\*\\*\\s*([^\\n·]+)`));
    return m ? m[1].trim() || null : null;
  };
  const status = field('Status');
  return {
    title: heading.replace(/^#\s*/, '').trim() || null,
    kind: field('Kind'),
    status: status ? status.slice(0, 80) : null
  };
}

// Handoff filenames: YYYY-MM-DD_HHMM_agent_project.md (project may itself
// contain dashes). -> { name, when: 'YYYY-MM-DD HH:MM', agent, project }
export function parseHandoffName(name) {
  const m = /^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})_([^_]+)_(.+)\.md$/.exec(typeof name === 'string' ? name : '');
  if (!m) return null;
  return { name, when: `${m[1]} ${m[2]}:${m[3]}`, agent: m[4], project: m[5] };
}

const stripMd = (s) => s
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/[*_`]/g, '')
  .replace(/^\s*[-*+]\s*(\[[ xX]\]\s*)?/, '')
  .trim();

// BOARD.md -> { blockers, boardLine }. Blocker lines mention BLOCKED /
// blocker, are markdown-stripped to 20-140 chars, max 3; headings and the
// Requests format example are not blockers. boardLine is the newest
// [sneaks → all] request line, trimmed, capped at 160 chars.
export function parseBoard(text) {
  const blockers = [];
  let boardLine = null;
  if (typeof text !== 'string') return { blockers, boardLine };
  for (const raw of text.split('\n')) {
    if (raw.includes('[sneaks → all]')) boardLine = raw.trim().slice(0, 160);
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('_Format')) continue;
    if (!/blocked|blocker/i.test(raw)) continue;
    const clean = stripMd(raw);
    if (clean.length < 20) continue;
    blockers.push(clean.length > 140 ? clean.slice(0, 140) : clean);
    if (blockers.length >= 3) break;
  }
  return { blockers, boardLine };
}

// Newest roll-call request line on BOARD.md ("- [... → all] ... ROLL CALL ...")
// -> { line, checked } where checked lists each agent that appended
// "· <agent> ✓ check" (lowercased, de-duplicated, max 20). null if none.
export function parseRollCall(text) {
  if (typeof text !== 'string') return null;
  let found = null;
  for (const raw of text.split('\n')) {
    if (/^\s*-\s*\[[^\]]*→\s*all\]/.test(raw) && /ROLL CALL/.test(raw)) found = raw;
  }
  if (!found) return null;
  const checked = [];
  for (const m of found.matchAll(/·\s*([a-z0-9][a-z0-9 ()_.-]{0,40}?)\s*✓\s*check\b/gi)) {
    const id = m[1].trim().toLowerCase();
    if (!checked.includes(id)) checked.push(id);
    if (checked.length >= 20) break;
  }
  return { line: stripMd(found).slice(0, 160), checked };
}

// Each read degrades on its own: a missing orders dir must not hide the
// blockers, and a GitHub outage answers with nulls, not a 500.
async function boardDigest(fetchImpl, token, repo) {
  let lastOrder = null;
  let latestHandoff = null;
  let blockers = [];
  let boardLine = null;
  let rollCall = null;
  try {
    const name = await latestName(fetchImpl, token, repo, 'orders');
    const parsed = name ? parseOrderFile(await readFile(fetchImpl, token, repo, `orders/${name}`)) : null;
    if (name && parsed) lastOrder = { name, ...parsed };
  } catch { /* keep null */ }
  try {
    const name = await latestName(fetchImpl, token, repo, 'handoffs');
    if (name) latestHandoff = parseHandoffName(name);
  } catch { /* keep null */ }
  try {
    const board = await readFile(fetchImpl, token, repo, 'BOARD.md');
    if (board) {
      ({ blockers, boardLine } = parseBoard(board));
      rollCall = parseRollCall(board);
    }
  } catch { /* keep [] / null */ }
  return { lastOrder, latestHandoff, blockers, boardLine, rollCall };
}

export async function handleStatus(request, env, deps = {}) {
  const cfg = config(env);
  const now = deps.now ?? Date.now();
  const { body, error } = await readJson(request, cfg);
  if (error) return error;
  if (!cfg.owner || cfg.secret.length < 32 || !cfg.token) {
    return json(503, { error: 'Crew status is not set up yet (passkey, SESSION_SECRET, GITHUB_TOKEN)' });
  }
  if (!(deps.limit ?? limitStatus)(now)) return json(429, { error: 'too many tries; wait 10 minutes' });

  if (body.action === 'options') {
    const options = await generateAuthenticationOptions({
      rpID: cfg.rpID, userVerification: 'required', timeout: 120000,
      allowCredentials: [{ id: cfg.owner.id, transports: cfg.owner.transports }]
    });
    return json(200, { options, token: signToken(cfg.secret, { purpose: 'status', challenge: options.challenge, now }) });
  }
  if (body.action !== 'view') return json(400, { error: 'unknown action' });

  let t;
  try { t = verifyToken(cfg.secret, body.token, { purpose: 'status', now }); } catch (e) { return json(401, { error: `challenge ${e.message}` }); }
  const assertion = body.assertion;
  if (!assertion || assertion.id !== cfg.owner.id) return json(401, { error: 'not the owner passkey' });
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response: assertion, expectedChallenge: t.c, expectedOrigin: cfg.origin,
      expectedRPID: cfg.rpID, credential: cfg.owner, requireUserVerification: true
    });
  } catch { return json(401, { error: 'Face ID check did not verify' }); }
  if (!result.verified) return json(401, { error: 'Face ID check did not verify' });

  const digest = await boardDigest(deps.fetchImpl ?? deps.fetch ?? fetch, cfg.token, cfg.repo);
  return json(200, digest);
}
