// Roll call: the whole loop on one screen (public/rollcall.html).
//
// POST /api/rollcall
//   {action:"options", mode:"start"|"watch"}        -> {options, token}
//   {action:"unlock", mode, token, assertion}        -> Face ID verified:
//        mode "start": writes a ROLL CALL order (same writer as Send to crew)
//        both modes:   returns {watch} — a 30-minute read-only pass
//   {action:"poll", watch}                           -> {rollCall}
//
// The watch pass only lets the page re-read who said check (agent ids and
// times from the newest "→ all" ROLL CALL line). It can't send anything.
// Bodies are never logged. Errors never include env values.
import {
  generateAuthenticationOptions, verifyAuthenticationResponse
} from '@simplewebauthn/server';
import { signToken, TOKEN_TTL_MS, verifyToken } from './challenge-token.mjs';
import { config, json, makeLimiter } from './handlers.mjs';
import { buildOrder, cleanInput, GitHubError, orderHash, writeOrder } from './order.mjs';

const MAX_BODY = 16 * 1024;
export const WATCH_TTL_MS = 30 * 60 * 1000;
const API = 'https://api.github.com';
const MODES = { start: 'rollcall-start', watch: 'rollcall-watch' };
const limits = { unlock: makeLimiter(20, 10 * 60e3), poll: makeLimiter(240, 10 * 60e3) };
const ORDER = cleanInput({ kind: 'rollcall', text: '' });

// Newest roll-call line ("- [... → all] ... ROLL CALL ...") on BOARD.md
// -> { date, checked: [{id, at}] } ; null if there is none. Each agent
// answers by appending "· <agent> ✓ check <HH:MM> ET". Ids lowercased,
// first answer kept, max 30.
export function parseRollCall(text) {
  if (typeof text !== 'string') return null;
  let found = null;
  for (const raw of text.split('\n')) {
    if (/^\s*-\s*\[[^\]]*→\s*all\]/.test(raw) && /ROLL CALL/.test(raw)) found = raw;
  }
  if (!found) return null;
  const checked = [];
  for (const m of found.matchAll(/·\s*([a-z0-9][a-z0-9 ()_.-]{0,40}?)\s*✓\s*check\b(?:\s*(\d{1,2}:\d{2}))?/gi)) {
    const id = m[1].trim().toLowerCase();
    if (checked.some((c) => c.id === id)) continue;
    checked.push({ id, at: m[2] || null });
    if (checked.length >= 30) break;
  }
  const date = (found.match(/\b(\d{4}-\d{2}-\d{2})\b/) || [])[1] || null;
  return { date, checked };
}

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

async function readBoard(fetchImpl, token, repo) {
  const res = await fetchImpl(`${API}/repos/${repo}/contents/BOARD.md`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'coms-pwa' }
  });
  if (res.status !== 200) return null;
  const file = await res.json();
  return typeof file?.content === 'string' ? Buffer.from(file.content.replace(/\s/g, ''), 'base64').toString('utf8') : null;
}

export async function handleRollCall(request, env, deps = {}) {
  const cfg = config(env);
  const now = deps.now ?? Date.now();
  const fetchImpl = deps.fetch ?? fetch;
  const { body, error } = await readJson(request, cfg);
  if (error) return error;
  if (!cfg.owner || cfg.secret.length < 32 || !cfg.token) {
    return json(503, { error: 'Roll call is not set up yet (passkey, SESSION_SECRET, GITHUB_TOKEN)' });
  }

  if (body.action === 'poll') {
    try { verifyToken(cfg.secret, body.watch, { purpose: 'rollcall-view', now }); } catch (e) { return json(401, { error: `watch pass ${e.message}` }); }
    if (!(deps.limitPoll ?? limits.poll)(now)) return json(429, { error: 'slow down' });
    let board = null;
    try { board = await readBoard(fetchImpl, cfg.token, cfg.repo); } catch { /* keep null */ }
    if (board === null) return json(502, { error: 'could not read the board' });
    return json(200, { rollCall: parseRollCall(board) });
  }

  const purpose = MODES[body.mode];
  if (!purpose) return json(400, { error: 'unknown mode' });
  if (!(deps.limitUnlock ?? limits.unlock)(now)) return json(429, { error: 'too many tries; wait a few minutes' });

  if (body.action === 'options') {
    const options = await generateAuthenticationOptions({
      rpID: cfg.rpID, userVerification: 'required', timeout: 120000,
      allowCredentials: [{ id: cfg.owner.id, transports: cfg.owner.transports }]
    });
    const bind = body.mode === 'start' ? orderHash(ORDER) : '';
    return json(200, { options, token: signToken(cfg.secret, { purpose, challenge: options.challenge, bind, now }) });
  }
  if (body.action !== 'unlock') return json(400, { error: 'unknown action' });

  let t;
  try { t = verifyToken(cfg.secret, body.token, { purpose, now }); } catch (e) { return json(401, { error: `challenge ${e.message}` }); }
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

  const watch = signToken(cfg.secret, { purpose: 'rollcall-view', challenge: 'view', now, ttl: WATCH_TTL_MS });
  if (body.mode === 'watch') return json(200, { watch });

  // Same replay guard as Send to crew: path from the signed issue time + nonce.
  const order = buildOrder(ORDER, t.n, new Date(t.e - TOKEN_TTL_MS));
  try {
    const out = await writeOrder({ fetchImpl, token: cfg.token, repo: cfg.repo, order });
    return json(200, { sent: true, boardUpdated: out.boardUpdated, orderPath: out.orderPath, watch });
  } catch (e) {
    if (e instanceof GitHubError) return json(e.status, { error: e.message });
    return json(502, { error: 'could not reach GitHub' });
  }
}
