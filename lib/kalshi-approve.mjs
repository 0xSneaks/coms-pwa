// Kalshi prod-order approval: Face ID -> Ed25519 signature the operator can't forge.
//
// POST /api/kalshi-approve
//   {action:"options", env:"prod", intent}            -> {options, token, preview_hash, summary}
//   {action:"approve", env:"prod", intent, token, assertion}
//        -> owner Face ID verified, intent re-hashed and matched to the token,
//           caps re-checked, then signs
//           kalshi-approve:v1:<preview_hash>:<expires_unix>
//        -> {preview_hash, signature_b64, expires_unix, dropPath}
//
// The signature is not a secret: it is bound to one order's hash and an
// expiry, and the kalshi-trader CLI burns it on first use. It is written to
// ai-coms approvals/kalshi/<hash>.sig.json so the operator can fetch it.
//
// preview_hash is computed exactly like kalshi-trader gates.intent_hash:
//   sha256(json.dumps({"env": env, "intent": asdict(intent)},
//                     sort_keys=True, separators=(",", ":")))
// Inputs are restricted to ASCII so Python and JS serialise identically.
//
// Env (set by Sneaks in Vercel; names only here):
//   KALSHI_APPROVER_PRIVATE_KEY_B64  base64 of the raw 32-byte Ed25519 seed (Sensitive)
// Bodies are never logged. Errors never include env values.
import { createHash, createPrivateKey, createPublicKey, sign as edSign } from 'node:crypto';
import {
  generateAuthenticationOptions, verifyAuthenticationResponse
} from '@simplewebauthn/server';
import { signToken, verifyToken } from './challenge-token.mjs';
import { config, json, makeLimiter } from './handlers.mjs';
import { GitHubError } from './order.mjs';

const MAX_BODY = 8 * 1024;
const PURPOSE = 'kalshi-approve';
export const APPROVAL_TTL_S = 10 * 60; // inside the CLI's 15-minute preview TTL
// Same hard ceilings as kalshi-trader config.py HARD_*: never sign above them.
export const HARD_MAX_ORDER_USD = 25;
const API = 'https://api.github.com';
const limits = { approve: makeLimiter(20, 10 * 60e3) };

const SEG = /^[A-Za-z0-9._-]{1,64}$/;
const DEC = /^(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,6})?$/;
const TIF = new Set(['good_till_canceled', 'fill_or_kill', 'immediate_or_cancel']);
export class IntentError extends Error {}

// Validate and copy only the known fields, in the CLI dataclass shape.
export function cleanIntent(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new IntentError('intent must be an object');
  const segOk = (v) => typeof v === 'string' && SEG.test(v) && v !== '.' && v !== '..';
  if ('order_id' in raw) {
    const keys = Object.keys(raw).sort().join(',');
    if (keys !== 'order_id,ticker') throw new IntentError('cancel intent must have exactly order_id and ticker');
    if (!segOk(raw.order_id) || !segOk(raw.ticker)) throw new IntentError('bad order_id or ticker');
    return { kind: 'cancel', fields: { order_id: raw.order_id, ticker: raw.ticker } };
  }
  const want = 'action,count,outcome,post_only,price,ticker,time_in_force';
  if (Object.keys(raw).sort().join(',') !== want) throw new IntentError(`order intent must have exactly: ${want}`);
  const { action, outcome, ticker, count, price, time_in_force, post_only } = raw;
  if (action !== 'buy' && action !== 'sell') throw new IntentError('action must be buy or sell');
  if (outcome !== 'yes' && outcome !== 'no') throw new IntentError('outcome must be yes or no');
  if (!segOk(ticker)) throw new IntentError('bad ticker');
  if (typeof count !== 'string' || !DEC.test(count) || Number(count) <= 0) throw new IntentError('count must be a positive decimal string');
  if (typeof price !== 'string' || !DEC.test(price) || !(Number(price) > 0 && Number(price) < 1)) {
    throw new IntentError('price must be a decimal string between 0 and 1');
  }
  if (!TIF.has(time_in_force)) throw new IntentError('bad time_in_force');
  if (typeof post_only !== 'boolean') throw new IntentError('post_only must be true or false');
  return { kind: 'order', fields: { action, outcome, ticker, count, price, time_in_force, post_only } };
}

// json.dumps(..., sort_keys=True, separators=(",", ":")) for this flat shape.
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

export function previewHash(env, intent) {
  return createHash('sha256').update(canonical({ env, intent: intent.fields }), 'utf8').digest('hex');
}

// Worst-case cash (Kalshi is fully collateralised) + the CLI's fee estimate.
export function orderTotalUsd(intent) {
  if (intent.kind === 'cancel') return 0;
  const c = Number(intent.fields.count);
  const p = Number(intent.fields.price);
  const cost = intent.fields.action === 'buy' ? c * p : c * (1 - p);
  const fee = Math.ceil(0.07 * c * p * (1 - p) * 100) / 100;
  return cost + fee;
}

export function summaryOf(intent, hash) {
  if (intent.kind === 'cancel') {
    return { what: `CANCEL order ${intent.fields.order_id} on ${intent.fields.ticker}`, total_usd: '0.00', preview_hash: hash };
  }
  const f = intent.fields;
  return {
    what: `${f.action.toUpperCase()} ${f.count} ${f.outcome.toUpperCase()} on ${f.ticker} @ $${f.price}`,
    time_in_force: f.time_in_force, post_only: f.post_only,
    total_usd: orderTotalUsd(intent).toFixed(2), preview_hash: hash
  };
}

export function approvalMessage(hash, expiresUnix) {
  return `kalshi-approve:v1:${hash}:${expiresUnix}`;
}

// Raw 32-byte Ed25519 seed (base64) -> KeyObject. Throws on anything else.
const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');
export function loadApproverKey(b64) {
  const seed = Buffer.from(String(b64 || '').trim(), 'base64');
  if (seed.length !== 32) throw new Error('approver key must be a 32-byte Ed25519 seed');
  return createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, seed]), format: 'der', type: 'pkcs8' });
}

// The public half, raw 32 bytes base64 — what the CLI pins.
export function publicKeyB64(key) {
  const spki = createPublicKey(key).export({ format: 'der', type: 'spki' });
  return spki.subarray(spki.length - 32).toString('base64');
}

async function readJson(request, cfg) {
  if (request.method !== 'POST') return { error: json(405, { error: 'POST only' }) };
  if (request.headers.get('origin') !== cfg.origin) return { error: json(403, { error: 'wrong origin' }) };
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return { error: json(403, { error: 'cross-site request refused' }) };
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
    return { error: json(415, { error: 'send JSON' }) };
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY) return { error: json(413, { error: 'body too large' }) };
  try {
    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return { body };
  } catch { return { error: json(400, { error: 'bad JSON' }) }; }
}

// Create-only: GitHub refuses a second file at the same path.
async function writeDrop(fetchImpl, token, repo, hash, drop) {
  const path = `approvals/kalshi/${hash}.sig.json`;
  const res = await fetchImpl(`${API}/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'coms-pwa', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `kalshi: owner Face ID approval for ${hash.slice(0, 12)}`,
      content: Buffer.from(JSON.stringify(drop, null, 2) + '\n').toString('base64')
    })
  });
  if (res.status === 201) return path;
  if (res.status === 422) throw new GitHubError(409, 'this order already has an approval; make a fresh preview');
  throw new GitHubError(502, 'could not save the approval to the board');
}

export async function handleKalshiApprove(request, env, deps = {}) {
  const cfg = config(env);
  const now = deps.now ?? Date.now();
  const fetchImpl = deps.fetch ?? fetch;
  const { body, error } = await readJson(request, cfg);
  if (error) return error;
  if (!cfg.owner || cfg.secret.length < 32 || !cfg.token || !env.KALSHI_APPROVER_PRIVATE_KEY_B64) {
    return json(503, { error: 'Kalshi approvals are not set up yet (passkey, SESSION_SECRET, GITHUB_TOKEN, approver key)' });
  }
  if (body.env !== 'prod') return json(400, { error: 'only prod orders need a Face ID approval' });
  let intent;
  try { intent = cleanIntent(body.intent); } catch (e) {
    return json(400, { error: e instanceof IntentError ? e.message : 'bad intent' });
  }
  if (orderTotalUsd(intent) > HARD_MAX_ORDER_USD) {
    return json(422, { error: `order total is over the $${HARD_MAX_ORDER_USD} cap; not signing` });
  }
  const hash = previewHash('prod', intent);
  if (!(deps.limitApprove ?? limits.approve)(now)) return json(429, { error: 'too many tries; wait a few minutes' });

  if (body.action === 'options') {
    const options = await generateAuthenticationOptions({
      rpID: cfg.rpID, userVerification: 'required', timeout: 120000,
      allowCredentials: [{ id: cfg.owner.id, transports: cfg.owner.transports }]
    });
    return json(200, {
      options, preview_hash: hash, summary: summaryOf(intent, hash),
      token: signToken(cfg.secret, { purpose: PURPOSE, challenge: options.challenge, bind: hash, now })
    });
  }
  if (body.action !== 'approve') return json(400, { error: 'unknown action' });

  let t;
  try { t = verifyToken(cfg.secret, body.token, { purpose: PURPOSE, now }); } catch (e) { return json(401, { error: `challenge ${e.message}` }); }
  // The order now must be exactly the order Face ID was asked for.
  if (t.b !== hash) return json(409, { error: 'order changed since Face ID was requested' });
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

  let key;
  try { key = loadApproverKey(env.KALSHI_APPROVER_PRIVATE_KEY_B64); } catch {
    return json(503, { error: 'approver key is not a valid Ed25519 seed' });
  }
  const expiresUnix = Math.floor(now / 1000) + APPROVAL_TTL_S;
  const signature = edSign(null, Buffer.from(approvalMessage(hash, expiresUnix), 'utf8'), key);
  const drop = { preview_hash: hash, signature_b64: signature.toString('base64'), expires_unix: expiresUnix };
  try {
    const dropPath = await writeDrop(fetchImpl, cfg.token, cfg.repo, hash, drop);
    return json(200, { ...drop, dropPath });
  } catch (e) {
    if (e instanceof GitHubError) return json(e.status, { error: e.message });
    return json(502, { error: 'could not reach GitHub' });
  }
}
