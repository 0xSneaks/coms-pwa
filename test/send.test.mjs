// Locked "Send to crew": passkey setup, Face ID-verified orders, replay /
// forgery / expiry refusals, input limits, and the AI COMS write (mocked).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleOrder, handleRegister } from '../lib/handlers.mjs';
import { signToken, verifyToken } from '../lib/challenge-token.mjs';
import { cleanInput, insertRequest, MAX_TEXT, summaryOf } from '../lib/order.mjs';
import { composeCommand } from '../public/commands.js';
import { fakeGitHub, makeAuthenticator } from './webauthn-helper.mjs';

const ORIGIN = 'https://coms-pwa.vercel.app';
const SECRET = 's'.repeat(40);
const GH_TOKEN = 'test-token-value-never-echoed';
const BOARD = `# BOARD

## 🚧 Blockers / questions for Sneaks

- [x] y · z · 2026-10-24

---

## 📨 Requests (agent → agent)

_Format: \`- [from → to] project · ask · OPEN · date → [note](handoffs/...)\`_

- [muse → claude-code] p · a · OPEN · 2026-10-24 → [note](handoffs/x.md)

---

## 📬 Latest handoffs (newest first, keep last 10)
`;
const NOW = Date.parse('2026-10-25T05:30:00Z'); // 01:30 ET

const post = (path, body, headers = {}) => new Request(`${ORIGIN}${path}`, {
  method: 'POST',
  headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body)
});
const read = async (res) => ({ status: res.status, body: await res.json() });
const allow = () => true;

function setup({ board = BOARD, boardConflicts = 0, boardFail = 0, now = NOW } = {}) {
  const auth = makeAuthenticator();
  const gh = fakeGitHub({ board, boardConflicts, boardFail });
  const env = { SESSION_SECRET: SECRET, GITHUB_TOKEN: GH_TOKEN, OWNER_PASSKEY: auth.ownerPasskey() };
  const deps = { fetch: gh.fetchImpl, now, limitChallenge: allow, limitSend: allow };
  const order = (body, d = deps) => handleOrder(post('/api/order', body), env, d).then(read);
  return { auth, gh, env, deps, order };
}

async function challenge(order, input = { kind: 'check', text: '' }) {
  const r = await order({ action: 'challenge', ...input });
  assert.equal(r.status, 200);
  assert.equal(r.body.options.userVerification, 'required');
  return r.body;
}

test('setup: code required, registers a real passkey, then closes', async () => {
  const auth = makeAuthenticator();
  const env = { SESSION_SECRET: SECRET, SETUP_CODE: 'one-time-code-123' };
  const reg = (body, e = env) => handleRegister(post('/api/passkey/register', body), e, { now: NOW, limit: allow }).then(read);
  assert.equal((await reg({ action: 'options', setupCode: 'wrong' })).status, 401);
  assert.equal((await reg({ action: 'options', setupCode: 'one-time-code-123' }, { SESSION_SECRET: SECRET })).status, 503);
  const opts = await reg({ action: 'options', setupCode: 'one-time-code-123' });
  assert.equal(opts.status, 200);
  assert.equal(opts.body.options.rp.id, 'coms-pwa.vercel.app');
  assert.equal(opts.body.options.authenticatorSelection.userVerification, 'required');
  const done = await reg({ action: 'verify', setupCode: 'one-time-code-123', token: opts.body.token,
    response: auth.register(opts.body.options.challenge) });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  const owner = JSON.parse(done.body.ownerPasskey);
  assert.equal(owner.id, auth.id);
  assert.ok(owner.publicKey.length > 40);
  // Registration from another origin, or without Face ID, does not verify.
  const o2 = await reg({ action: 'options', setupCode: 'one-time-code-123' });
  assert.equal((await reg({ action: 'verify', setupCode: 'one-time-code-123', token: o2.body.token,
    response: auth.register(o2.body.options.challenge, { clientOrigin: 'https://evil.example' }) })).status, 401);
  assert.equal((await reg({ action: 'verify', setupCode: 'one-time-code-123', token: o2.body.token,
    response: auth.register(o2.body.options.challenge, { flags: 0x41 }) })).status, 401);
  // Once OWNER_PASSKEY is set, setup is refused even with the right code.
  const closed = await reg({ action: 'options', setupCode: 'one-time-code-123' }, { ...env, OWNER_PASSKEY: done.body.ownerPasskey });
  assert.equal(closed.status, 403);
});

test('send: Face ID assertion -> order file + [sneaks → all] board line', async () => {
  const { auth, gh, order } = setup();
  const input = { kind: 'react', text: 'Ship the relay\nfix today', project: 'muse-tune-up' };
  const c = await challenge(order, input);
  const r = await order({ action: 'send', token: c.token, assertion: auth.assert(c.options.challenge), ...input });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.boardUpdated, true);
  assert.match(r.body.orderPath, /^orders\/2026-10-25_0130_[0-9a-f]{12}\.md$/);
  const file = gh.files.get(r.body.orderPath).text;
  assert.match(file, /^# Order — sneaks → all — 2026-10-25 01:30 ET/);
  assert.match(file, /verified by Face ID passkey/);
  assert.ok(file.includes('> REACT'));
  assert.ok(file.includes('> Ship the relay'));
  const board = gh.files.get('BOARD.md').text;
  const line = `- [sneaks → all] muse-tune-up · REACT: Ship the relay fix today · OPEN · 2026-10-25 → [order](${r.body.orderPath})`;
  assert.ok(board.includes(line), board);
  // The line lands inside the Requests section, after the existing request.
  const reqStart = board.indexOf('## 📨 Requests');
  const latest = board.indexOf('## 📬 Latest handoffs');
  assert.ok(board.indexOf(line) > board.indexOf('- [muse → claude-code]') && board.indexOf(line) < latest && reqStart >= 0);
  assert.ok(gh.calls.every((c) => c.auth === `Bearer ${GH_TOKEN}`));
  assert.equal(gh.calls[0].body.sha, undefined); // create-only
  assert.ok(!JSON.stringify(r.body).includes(GH_TOKEN));
});

test('replayed assertion cannot send twice', async () => {
  const { auth, gh, order } = setup();
  const c = await challenge(order);
  const assertion = auth.assert(c.options.challenge);
  const body = { action: 'send', token: c.token, assertion, kind: 'check', text: '' };
  assert.equal((await order(body)).status, 200);
  const again = await order(body);
  assert.equal(again.status, 409);
  assert.match(again.body.error, /already sent/);
  assert.equal([...gh.files.keys()].filter((k) => k.startsWith('orders/')).length, 1);
});

test('replay later (+65 s, and across midnight) still hits the same order: one order, one line', async () => {
  for (const start of [NOW, Date.parse('2026-10-26T03:59:30Z')]) { // 01:30 ET; 23:59:30 ET
    const { auth, gh, order, deps } = setup({ now: start });
    const c = await challenge(order);
    const body = { action: 'send', token: c.token, assertion: auth.assert(c.options.challenge), kind: 'check' };
    assert.equal((await order(body)).status, 200);
    const later = await order(body, { ...deps, now: start + 65_000 }); // next minute (and next day for 23:59:30)
    assert.equal(later.status, 409, new Date(start).toISOString());
    assert.equal([...gh.files.keys()].filter((k) => k.startsWith('orders/')).length, 1);
    assert.equal(gh.files.get('BOARD.md').text.split('[sneaks → all]').length - 1, 1);
  }
});

test('partial send (board write failed) is repaired by re-sending the same approval, never duplicated', async () => {
  const { auth, gh, order } = setup({ boardFail: 1 });
  const input = { kind: 'react', text: 'x' };
  const c = await challenge(order, input);
  const body = { action: 'send', token: c.token, assertion: auth.assert(c.options.challenge), ...input };
  const first = await order(body);
  assert.equal(first.status, 200);
  assert.equal(first.body.boardUpdated, false);
  assert.ok(!gh.files.get('BOARD.md').text.includes('[sneaks → all]'));
  const retry = await order(body);
  assert.equal(retry.status, 200);
  assert.deepEqual([retry.body.boardUpdated, retry.body.repaired], [true, true]);
  const third = await order(body);
  assert.equal(third.status, 409);
  assert.equal(gh.files.get('BOARD.md').text.split('[sneaks → all]').length - 1, 1);
  assert.equal([...gh.files.keys()].filter((k) => k.startsWith('orders/')).length, 1);
});

test('setup stays closed when OWNER_PASSKEY is set but malformed; Send is 503', async () => {
  const env = { SESSION_SECRET: SECRET, SETUP_CODE: 'still-here', OWNER_PASSKEY: '{"oops": true' };
  const r = await read(await handleRegister(post('/api/passkey/register', { action: 'options', setupCode: 'still-here' }), env, { now: NOW, limit: allow }));
  assert.equal(r.status, 403);
  for (const bad of ['{"oops": true', 'not json', '{"id": 5}', '  {}  ']) {
    const s = await read(await handleOrder(post('/api/order', { action: 'challenge', kind: 'check' }),
      { SESSION_SECRET: SECRET, GITHUB_TOKEN: GH_TOKEN, OWNER_PASSKEY: bad }, {}));
    assert.equal(s.status, 503, bad);
    const reg = await read(await handleRegister(post('/api/passkey/register', { action: 'options', setupCode: 'still-here' }),
      { ...env, OWNER_PASSKEY: bad }, { now: NOW, limit: allow }));
    assert.equal(reg.status, 403, bad);
  }
});

test('oversized body refused from Content-Length before reading', async () => {
  const { env, deps } = setup();
  const req = post('/api/order', { action: 'challenge', kind: 'check' }, { 'Content-Length': '999999' });
  assert.equal((await read(await handleOrder(req, env, deps))).status, 413);
});

test('forged, wrong-challenge, no-Face-ID, wrong-origin and wrong-RP assertions are refused', async () => {
  const { auth, gh, order } = setup();
  const c = await challenge(order);
  const other = await challenge(order);
  const cases = {
    forged: auth.assert(c.options.challenge, { key: auth.otherKey }),
    wrongChallenge: auth.assert(other.options.challenge),
    noFaceID: auth.assert(c.options.challenge, { flags: 0x01 }),
    wrongOrigin: auth.assert(c.options.challenge, { clientOrigin: 'https://evil.example' }),
    wrongRP: auth.assert(c.options.challenge, { rp: 'evil.example' }),
    otherCredential: { ...auth.assert(c.options.challenge), id: 'AAAA', rawId: 'AAAA' }
  };
  for (const [name, assertion] of Object.entries(cases)) {
    const r = await order({ action: 'send', token: c.token, assertion, kind: 'check' });
    assert.equal(r.status, 401, name);
  }
  assert.equal(gh.calls.length, 0);
});

test('Face ID approves one exact order: swapped text, kind or project is refused', async () => {
  const { auth, gh, order } = setup();
  const input = { kind: 'react', text: 'what Sneaks saw', project: 'general' };
  const c = await challenge(order, input);
  const assertion = auth.assert(c.options.challenge);
  for (const swap of [{ text: 'something else' }, { kind: 'review' }, { project: 'muse-tune-up' }]) {
    const r = await order({ action: 'send', token: c.token, assertion, ...input, ...swap });
    assert.equal(r.status, 401, JSON.stringify(swap));
    assert.match(r.body.error, /order changed/);
  }
  assert.equal(gh.calls.length, 0);
  assert.equal((await order({ action: 'send', token: c.token, assertion, ...input })).status, 200);
});

test('expired, tampered or wrong-purpose challenge tokens are refused', async () => {
  const { auth, gh, order, deps } = setup();
  const c = await challenge(order);
  const assertion = auth.assert(c.options.challenge);
  const late = await order({ action: 'send', token: c.token, assertion, kind: 'check' }, { ...deps, now: NOW + 121_000 });
  assert.equal(late.status, 401);
  assert.match(late.body.error, /expired/);
  const [b, m] = c.token.split('.');
  const tampered = `${b.slice(0, -2)}AA.${m}`;
  assert.equal((await order({ action: 'send', token: tampered, assertion, kind: 'check' })).status, 401);
  const regToken = signToken(SECRET, { purpose: 'register', challenge: c.options.challenge, now: NOW });
  const wrong = await order({ action: 'send', token: regToken, assertion, kind: 'check' });
  assert.equal(wrong.status, 401);
  assert.equal(gh.calls.length, 0);
  assert.throws(() => verifyToken('x'.repeat(40), c.token, { purpose: 'order', now: NOW }), /bad token/);
});

test('request guard: same-origin JSON POST only, size and input limits', async () => {
  const { env, deps, auth, order } = setup();
  const call = (req) => handleOrder(req, env, deps).then(read);
  assert.equal((await call(post('/api/order', { action: 'challenge' }, { Origin: 'https://evil.example' }))).status, 403);
  assert.equal((await call(post('/api/order', { action: 'challenge' }, { 'Sec-Fetch-Site': 'cross-site' }))).status, 403);
  assert.equal((await call(post('/api/order', { action: 'challenge' }, { 'Content-Type': 'text/plain' }))).status, 415);
  assert.equal((await call(post('/api/order', 'x'.repeat(17000)))).status, 413);
  assert.equal((await call(post('/api/order', '{bad'))).status, 400);
  assert.equal((await call(new Request(`${ORIGIN}/api/order`, { method: 'GET', headers: { Origin: ORIGIN } }))).status, 405);
  const c = await challenge(order);
  const assertion = auth.assert(c.options.challenge);
  const long = await order({ action: 'send', token: c.token, assertion, kind: 'react', text: 'x'.repeat(MAX_TEXT + 1) });
  assert.equal(long.status, 400);
  assert.equal((await order({ action: 'send', token: c.token, assertion, kind: 'react', text: '   ' })).status, 400);
  assert.equal((await order({ action: 'send', token: c.token, assertion, kind: 'check', project: '../x' })).status, 400);
  assert.equal((await order({ action: 'send', token: c.token, assertion, kind: 'launch' })).status, 400);
  // Bad input is refused before Face ID is even asked for.
  assert.equal((await order({ action: 'challenge', kind: 'react', text: 'x'.repeat(MAX_TEXT + 1) })).status, 400);
  assert.equal((await order({ action: 'nope' })).status, 400);
});

test('not configured -> 503, and setup never reveals env values', async () => {
  const r = await read(await handleOrder(post('/api/order', { action: 'challenge' }), { SESSION_SECRET: SECRET }, {}));
  assert.equal(r.status, 503);
  const bad = await read(await handleOrder(post('/api/order', { action: 'challenge' }),
    { SESSION_SECRET: SECRET, GITHUB_TOKEN: GH_TOKEN, OWNER_PASSKEY: '{not json' }, {}));
  assert.equal(bad.status, 503);
  assert.ok(!JSON.stringify(bad.body).includes(GH_TOKEN));
});

test('board race: retries on a stale sha, keeps the other agent\'s change', async () => {
  const { auth, gh, order } = setup({ boardConflicts: 2 });
  const c = await challenge(order);
  const r = await order({ action: 'send', token: c.token, assertion: auth.assert(c.options.challenge), kind: 'check' });
  assert.equal(r.body.boardUpdated, true);
  const board = gh.files.get('BOARD.md').text;
  assert.ok(board.includes('<!-- other agent -->'));
  assert.ok(board.includes('- [sneaks → all] general · CHECK COMS · OPEN'));
  assert.equal(gh.calls.filter((x) => x.method === 'GET').length, 3);
});

test('unknown board layout: order file still written, board untouched, says so', async () => {
  const { auth, gh, order } = setup({ board: '# BOARD\n\nnothing here\n' });
  const c = await challenge(order);
  const r = await order({ action: 'send', token: c.token, assertion: auth.assert(c.options.challenge), kind: 'check' });
  assert.equal(r.status, 200);
  assert.equal(r.body.boardUpdated, false);
  assert.equal(gh.files.get('BOARD.md').text, '# BOARD\n\nnothing here\n');
  assert.ok(gh.files.has(r.body.orderPath));
});

test('input cleaning and summaries', () => {
  const x = cleanInput({ kind: 'react', text: 'a\u0000b‮c\r\nd e' });
  assert.equal(x.text, 'abc\nde');
  assert.equal(summaryOf({ kind: 'react', text: 'use `rm -rf`\nnow' }), "REACT: use 'rm -rf' now");
  assert.ok(summaryOf({ kind: 'review', text: 'y'.repeat(500) }).length <= 'REVIEW AND BREAK DOWN: '.length + 140);
  assert.throws(() => insertRequest('# no requests here', '- x'), /Requests/);
});

test('every command shows its own part first, before the shared board prelude', () => {
  for (const kind of ['check', 'react', 'review']) {
    const lines = composeCommand(kind, 'the task').split('\n');
    const firstFour = lines.slice(0, 4).join('\n');
    assert.ok(firstFour.includes('the task') || kind === 'check', kind);
    assert.ok(composeCommand(kind, 'the task').indexOf('the task') < composeCommand(kind, 'the task').indexOf('BOARD.md'), kind);
  }
});
