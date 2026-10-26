// Stateless, signed WebAuthn challenges.
//
// The server keeps no session store: each challenge travels to the phone and
// back inside a token HMAC-signed with SESSION_SECRET, valid for 2 minutes and
// bound to one purpose ("register" or "order"). A random nonce in the token
// names the order file, and GitHub refuses to create the same file twice, so
// one challenge can send at most one order (replay protection).
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const TOKEN_TTL_MS = 2 * 60 * 1000;
const b64u = (buf) => Buffer.from(buf).toString('base64url');

export function signToken(secret, { purpose, challenge, bind = '', now = Date.now(), ttl = TOKEN_TTL_MS }) {
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  // b: hash of the exact order (kind, text, project) shown when Face ID was asked for.
  const payload = { p: purpose, c: challenge, b: bind, n: randomBytes(6).toString('hex'), e: now + ttl };
  const body = b64u(JSON.stringify(payload));
  const mac = b64u(createHmac('sha256', secret).update(body).digest());
  return `${body}.${mac}`;
}

// -> payload {p, c, b, n, e}; throws Error('bad token' | 'expired' | 'wrong purpose').
export function verifyToken(secret, token, { purpose, now = Date.now() }) {
  if (!secret || typeof token !== 'string' || token.length > 1024) throw new Error('bad token');
  const [body, mac, extra] = token.split('.');
  if (!body || !mac || extra !== undefined) throw new Error('bad token');
  const want = createHmac('sha256', secret).update(body).digest();
  const got = Buffer.from(mac, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw new Error('bad token');
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { throw new Error('bad token'); }
  if (payload.p !== purpose) throw new Error('wrong purpose');
  if (typeof payload.e !== 'number' || now > payload.e) throw new Error('expired');
  if (typeof payload.c !== 'string' || !/^[0-9a-f]{12}$/.test(payload.n)) throw new Error('bad token');
  return payload;
}
