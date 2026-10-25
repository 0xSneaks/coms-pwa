// Request handlers for the locked "Send to crew" flow. Web-standard
// Request -> Response, so the same code runs on Vercel and in tests.
//
// POST /api/passkey/register  one-time owner passkey setup (needs SETUP_CODE;
//                             refused once OWNER_PASSKEY is set)
// POST /api/order             {action:"challenge"} then {action:"send", ...}
//
// Env (set by Sneaks in Vercel; names only, never values, in this repo):
//   SESSION_SECRET  ≥32 chars, signs challenges          (Sensitive)
//   SETUP_CODE      one-time code for passkey setup       (Sensitive)
//   OWNER_PASSKEY   JSON printed by setup: public key, not a secret
//   GITHUB_TOKEN    fine-grained, ai-coms only, Contents R/W (Sensitive)
//   COMS_REPO       default 0xSneaks/ai-coms
//   RP_ID / ORIGIN  default coms-pwa.vercel.app / https://coms-pwa.vercel.app
//
// Bodies are never logged. Errors never include env values.
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  generateAuthenticationOptions, generateRegistrationOptions,
  verifyAuthenticationResponse, verifyRegistrationResponse
} from '@simplewebauthn/server';
import { signToken, TOKEN_TTL_MS, verifyToken } from './challenge-token.mjs';
import { buildOrder, cleanInput, GitHubError, InputError, orderHash, writeOrder } from './order.mjs';

const MAX_BODY = 16 * 1024;

export function config(env) {
  const rpID = env.RP_ID || 'coms-pwa.vercel.app';
  return {
    rpID,
    origin: env.ORIGIN || `https://${rpID}`,
    repo: env.COMS_REPO || '0xSneaks/ai-coms',
    secret: env.SESSION_SECRET || '',
    setupCode: env.SETUP_CODE || '',
    token: env.GITHUB_TOKEN || '',
    // Set at all (even malformed) = setup closed. Parsed = Send can use it.
    ownerSet: Boolean(env.OWNER_PASSKEY && String(env.OWNER_PASSKEY).trim()),
    owner: parseOwner(env.OWNER_PASSKEY)
  };
}

export function parseOwner(raw) {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (typeof o.id !== 'string' || typeof o.publicKey !== 'string') return null;
    return { id: o.id, publicKey: new Uint8Array(Buffer.from(o.publicKey, 'base64url')),
      counter: Number.isInteger(o.counter) ? o.counter : 0,
      transports: Array.isArray(o.transports) ? o.transports : undefined };
  } catch { return null; }
}

export function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

// Simple per-instance limiter. The passkey is the real lock; this only
// slows down noise against a warm instance.
export function makeLimiter(max, windowMs) {
  const hits = [];
  return (now = Date.now()) => {
    while (hits.length && now - hits[0] > windowMs) hits.shift();
    if (hits.length >= max) return false;
    hits.push(now);
    return true;
  };
}
const limits = { setup: makeLimiter(5, 10 * 60e3), challenge: makeLimiter(30, 10 * 60e3), send: makeLimiter(10, 10 * 60e3) };

// Same-origin JSON POST only; no CORS is ever answered.
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

function sameSecret(a, b) {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb) && Boolean(a) && Boolean(b);
}

export async function handleRegister(request, env, deps = {}) {
  const cfg = config(env);
  const now = deps.now ?? Date.now();
  const { body, error } = await readJson(request, cfg);
  if (error) return error;
  if (cfg.ownerSet) return json(403, { error: 'OWNER_PASSKEY is set; setup is closed' });
  if (!cfg.setupCode || cfg.secret.length < 32) return json(503, { error: 'setup is not configured (SETUP_CODE, SESSION_SECRET)' });
  if (!(deps.limit ?? limits.setup)(now)) return json(429, { error: 'too many tries; wait 10 minutes' });
  if (!sameSecret(body.setupCode, cfg.setupCode)) return json(401, { error: 'wrong setup code' });

  if (body.action === 'options') {
    const options = await generateRegistrationOptions({
      rpName: 'AI COMS', rpID: cfg.rpID, userName: 'sneaks', userDisplayName: 'Sneaks',
      userID: new TextEncoder().encode('sneaks-owner'), attestationType: 'none',
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      supportedAlgorithmIDs: [-7, -257], timeout: 120000
    });
    return json(200, { options, token: signToken(cfg.secret, { purpose: 'register', challenge: options.challenge, now }) });
  }
  if (body.action === 'verify') {
    let t;
    try { t = verifyToken(cfg.secret, body.token, { purpose: 'register', now }); } catch (e) { return json(401, { error: `challenge ${e.message}` }); }
    let result;
    try {
      result = await verifyRegistrationResponse({
        response: body.response, expectedChallenge: t.c, expectedOrigin: cfg.origin,
        expectedRPID: cfg.rpID, requireUserVerification: true
      });
    } catch { return json(401, { error: 'passkey registration did not verify' }); }
    if (!result.verified) return json(401, { error: 'passkey registration did not verify' });
    const c = result.registrationInfo.credential;
    const ownerPasskey = JSON.stringify({ id: c.id, publicKey: Buffer.from(c.publicKey).toString('base64url'), counter: c.counter, transports: c.transports });
    return json(200, { ownerPasskey, next: 'Add this as the OWNER_PASSKEY env var in Vercel, then redeploy. Setup closes once it is set.' });
  }
  return json(400, { error: 'unknown action' });
}

export async function handleOrder(request, env, deps = {}) {
  const cfg = config(env);
  const now = deps.now ?? Date.now();
  const { body, error } = await readJson(request, cfg);
  if (error) return error;
  if (!cfg.owner || cfg.secret.length < 32 || !cfg.token) {
    return json(503, { error: 'Send to crew is not set up yet (passkey, SESSION_SECRET, GITHUB_TOKEN)' });
  }

  // The order (kind, text, project) is sent with BOTH steps: cleaned and
  // hashed into the challenge first, then it must match at send time.
  let input;
  if (body.action === 'challenge' || body.action === 'send') {
    try { input = cleanInput(body); } catch (e) {
      if (e instanceof InputError) return json(400, { error: e.message });
      throw e;
    }
  }

  if (body.action === 'challenge') {
    if (!(deps.limitChallenge ?? limits.challenge)(now)) return json(429, { error: 'too many tries; wait a few minutes' });
    const options = await generateAuthenticationOptions({
      rpID: cfg.rpID, userVerification: 'required', timeout: 120000,
      allowCredentials: [{ id: cfg.owner.id, transports: cfg.owner.transports }]
    });
    return json(200, { options, token: signToken(cfg.secret, { purpose: 'order', challenge: options.challenge, bind: orderHash(input), now }) });
  }
  if (body.action !== 'send') return json(400, { error: 'unknown action' });
  if (!(deps.limitSend ?? limits.send)(now)) return json(429, { error: 'too many sends; wait a few minutes' });

  let t;
  try { t = verifyToken(cfg.secret, body.token, { purpose: 'order', now }); } catch (e) { return json(401, { error: `challenge ${e.message}` }); }
  if (t.b !== orderHash(input)) return json(401, { error: 'the order changed after Face ID was requested; nothing sent' });
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

  // Path and timestamps from the signed issue time, never the current clock:
  // a replay later (even past midnight) maps to the same create-only file.
  const order = buildOrder(input, t.n, new Date(t.e - TOKEN_TTL_MS));
  try {
    const out = await writeOrder({ fetchImpl: deps.fetch ?? fetch, token: cfg.token, repo: cfg.repo, order });
    return json(200, { ok: true, ...out });
  } catch (e) {
    if (e instanceof GitHubError) return json(e.status, { error: e.message });
    return json(502, { error: 'could not reach GitHub' });
  }
}
