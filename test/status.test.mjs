// Locked, read-only "Crew status": Face ID unlock, board digest parsing,
// graceful degradation when the board can't be read (mocked GitHub).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleStatus, parseBoard, parseHandoffName, parseOrderFile } from '../lib/status.mjs';
import { signToken, verifyToken } from '../lib/challenge-token.mjs';
import { makeAuthenticator } from './webauthn-helper.mjs';

const ORIGIN = 'https://coms-pwa.vercel.app';
const SECRET = 's'.repeat(40);
const GH_TOKEN = 'test-token-value-never-echoed';
const NOW = Date.parse('2026-10-25T05:30:00Z'); // 01:30 ET
const ORDER_NAME = '2026-10-25_0130_e7b3b04bde99.md';
const ORDER_FILE = `# Order — sneaks → all — 2026-10-25 01:30 ET

**From:** Sneaks, verified by Face ID passkey in coms-pwa · **Kind:** CHECK COMS · **Project:** general
**Status:** OPEN. Every agent: handle it per RULE.md v2 and mark your part in your sign-off.

> CHECK COMS
`;
const BOARD = `# BOARD

## 🚧 Blockers / questions for Sneaks

- BLOCKED: waiting on Sneaks to approve the Vercel env change before anything can ship
- muse-tune-up is fine

---

## 📨 Requests (agent → agent)

_Format: \`- [from → to] project · ask · OPEN · date → [note](handoffs/...)\`_

- [sneaks → all] general · CHECK COMS · OPEN · 2026-10-25 → [order](orders/${ORDER_NAME})
- [muse → all] halfmoon · REACT: thing · OPEN · 2026-10-25 → [note](handoffs/x.md)
- [sneaks → all] muse-tune-up · REACT: Ship the relay fix today · OPEN · 2026-10-25 → [order](orders/${ORDER_NAME})

---

## 📬 Latest handoffs (newest first, keep last 10)
`;

const post = (path, body, headers = {}) => new Request(`${ORIGIN}${path}`, {
  method: 'POST',
  headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body)
});
const read = async (res) => ({ status: res.status, body: await res.json() });
const allow = () => true;
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

// Contents API double for the status reads: directory listings + file bodies.
function fakeStatusGitHub({ orders = [], orderFiles = {}, handoffs = [], board = BOARD } = {}) {
  const calls = [];
  const reply = (status, body) => new Response(JSON.stringify(body), { status });
  const fetchImpl = async (url, init) => {
    const { pathname } = new URL(url);
    const path = decodeURIComponent(pathname.replace(/^\/repos\/[^/]+\/[^/]+\/contents\//, ''));
    calls.push({ method: init.method, path, auth: init.headers.Authorization });
    if (path === 'orders') return reply(200, orders.map((name) => ({ name, path: `orders/${name}`, type: 'file' })));
    if (path.startsWith('orders/')) {
      const name = path.slice('orders/'.length);
      return Object.hasOwn(orderFiles, name) ? reply(200, { content: b64(orderFiles[name]) }) : reply(404, {});
    }
    if (path === 'handoffs') return reply(200, handoffs.map((name) => ({ name, path: `handoffs/${name}`, type: 'file' })));
    if (path === 'BOARD.md') return reply(200, { content: b64(board) });
    return reply(404, {});
  };
  return { fetchImpl, calls };
}

function setup(gh = fakeStatusGitHub({
  orders: ['2026-10-24_2200_aaaaaaaaaaaa.md', ORDER_NAME, 'zzz-notes.txt'],
  orderFiles: { [ORDER_NAME]: ORDER_FILE },
  handoffs: ['2026-10-25_0200_muse_inside-the-block.md', '2026-10-25_0215_claude-code_coms-pwa.md', '2026-10-24_2359_codex_muse-tune-up.md']
})) {
  const auth = makeAuthenticator();
  const env = { SESSION_SECRET: SECRET, GITHUB_TOKEN: GH_TOKEN, OWNER_PASSKEY: auth.ownerPasskey() };
  const deps = { now: NOW, limit: allow, fetchImpl: gh.fetchImpl };
  const status = (body, d = deps, e = env) => handleStatus(post('/api/status', body), e, d).then(read);
  return { auth, gh, env, deps, status };
}

async function options(status) {
  const r = await status({ action: 'options' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}

test('status: not configured -> 503, never reveals env values', async () => {
  const { status, env } = setup();
  for (const e of [{}, { SESSION_SECRET: SECRET }, { SESSION_SECRET: SECRET, GITHUB_TOKEN: GH_TOKEN },
    { SESSION_SECRET: SECRET, GITHUB_TOKEN: GH_TOKEN, OWNER_PASSKEY: '{not json' },
    { SESSION_SECRET: 'short', GITHUB_TOKEN: GH_TOKEN, OWNER_PASSKEY: env.OWNER_PASSKEY }]) {
    const r = await status({ action: 'options' }, undefined, e);
    assert.equal(r.status, 503, JSON.stringify(e));
    assert.ok(!JSON.stringify(r.body).includes(GH_TOKEN));
  }
});

test('status: options offers only the owner passkey and a status-purpose token', async () => {
  const { auth, status } = setup();
  const { options: opts, token } = await options(status);
  assert.equal(opts.userVerification, 'required');
  assert.equal(opts.allowCredentials.length, 1);
  assert.equal(opts.allowCredentials[0].id, auth.id);
  const payload = verifyToken(SECRET, token, { purpose: 'status', now: NOW });
  assert.equal(payload.c, opts.challenge);
  assert.throws(() => verifyToken(SECRET, token, { purpose: 'order', now: NOW }), /wrong purpose/);
});

test('status: view refuses bad, tampered and wrong-purpose tokens before Face ID', async () => {
  const { auth, gh, status } = setup();
  const { options: opts, token } = await options(status);
  const assertion = auth.assert(opts.challenge);
  assert.equal((await status({ action: 'view', token: 'garbage.token', assertion })).status, 401);
  const [b, m] = token.split('.');
  assert.equal((await status({ action: 'view', token: `${b.slice(0, -2)}AA.${m}`, assertion })).status, 401);
  const orderToken = signToken(SECRET, { purpose: 'order', challenge: opts.challenge, now: NOW });
  const wrong = await status({ action: 'view', token: orderToken, assertion });
  assert.equal(wrong.status, 401);
  assert.match(wrong.body.error, /wrong purpose/);
  // A different credential and a forged signature are refused too.
  assert.equal((await status({ action: 'view', token, assertion: { ...assertion, id: 'AAAA', rawId: 'AAAA' } })).status, 401);
  assert.equal((await status({ action: 'view', token, assertion: auth.assert(opts.challenge, { key: auth.otherKey }) })).status, 401);
  assert.equal(gh.calls.length, 0);
});

test('status: Face ID unlock returns the parsed board digest', async () => {
  const { auth, gh, status } = setup();
  const { options: opts, token } = await options(status);
  const r = await status({ action: 'view', token, assertion: auth.assert(opts.challenge) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.lastOrder, {
    name: ORDER_NAME,
    title: 'Order — sneaks → all — 2026-10-25 01:30 ET',
    kind: 'CHECK COMS',
    status: 'OPEN. Every agent: handle it per RULE.md v2 and mark your part in your sign-off.'
  });
  assert.deepEqual(r.body.latestHandoff, {
    name: '2026-10-25_0215_claude-code_coms-pwa.md',
    when: '2026-10-25 02:15',
    agent: 'claude-code',
    project: 'coms-pwa'
  });
  assert.deepEqual(r.body.blockers, [
    'BLOCKED: waiting on Sneaks to approve the Vercel env change before anything can ship'
  ]);
  assert.ok(r.body.boardLine.startsWith('- [sneaks → all] muse-tune-up · REACT: Ship the relay fix today'));
  assert.ok(gh.calls.length > 0 && gh.calls.every((c) => c.method === 'GET' && c.auth === `Bearer ${GH_TOKEN}`));
  assert.ok(!JSON.stringify(r.body).includes(GH_TOKEN));
});

test('status: board reads fail soft — a GitHub outage still answers 200 with nulls', async () => {
  const down = { fetchImpl: async () => { throw new Error('network down'); } };
  const { auth, status, deps } = setup();
  const { options: opts, token } = await options(status);
  const r = await status({ action: 'view', token, assertion: auth.assert(opts.challenge) }, { ...deps, ...down });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { lastOrder: null, latestHandoff: null, blockers: [], boardLine: null, rollCall: null });

  const missing = { fetchImpl: async () => new Response('{}', { status: 404 }) };
  const o2 = await options(status);
  const r2 = await status({ action: 'view', token: o2.token, assertion: auth.assert(o2.options.challenge) }, { ...deps, ...missing });
  assert.equal(r2.status, 200);
  assert.deepEqual(r2.body, { lastOrder: null, latestHandoff: null, blockers: [], boardLine: null, rollCall: null });
});

test('status: request guard mirrors the order endpoint', async () => {
  const { status, env, deps } = setup();
  const call = (req) => handleStatus(req, env, deps).then(read);
  assert.equal((await call(post('/api/status', { action: 'options' }, { Origin: 'https://evil.example' }))).status, 403);
  assert.equal((await call(post('/api/status', { action: 'options' }, { 'Content-Type': 'text/plain' }))).status, 415);
  assert.equal((await call(new Request(`${ORIGIN}/api/status`, { method: 'GET', headers: { Origin: ORIGIN } }))).status, 405);
  assert.equal((await status({ action: 'nope' })).status, 400);
});

test('handoff filename parsing', () => {
  assert.deepEqual(parseHandoffName('2026-10-25_0215_claude-code_coms-pwa.md'), {
    name: '2026-10-25_0215_claude-code_coms-pwa.md', when: '2026-10-25 02:15', agent: 'claude-code', project: 'coms-pwa'
  });
  assert.equal(parseHandoffName('2026-10-25_0335_muse_inside-the-block-recompute.md').project, 'inside-the-block-recompute');
  assert.equal(parseHandoffName('2026-10-25_0042_muse_inside-the-block.md').agent, 'muse');
  assert.equal(parseHandoffName('README.md'), null);
  assert.equal(parseHandoffName('2026-10-25_0215.md'), null);
  assert.equal(parseHandoffName('not-a-handoff.md'), null);
});

test('order file and board parsing', () => {
  const o = parseOrderFile(ORDER_FILE);
  assert.equal(o.title, 'Order — sneaks → all — 2026-10-25 01:30 ET');
  assert.equal(o.kind, 'CHECK COMS');
  assert.ok(o.status.startsWith('OPEN.'));
  assert.equal(parseOrderFile('no fields here').kind, null);
  assert.equal(parseOrderFile(null), null);

  const { blockers, boardLine } = parseBoard(BOARD);
  assert.equal(blockers.length, 1); // the "## 🚧 Blockers" heading is not itself a blocker
  assert.ok(boardLine.includes('muse-tune-up'));
  const many = parseBoard(Array.from({ length: 6 }, (_, i) => `- BLOCKED item number ${i} with enough text to pass`).join('\n'));
  assert.equal(many.blockers.length, 3); // capped
  assert.deepEqual(parseBoard(''), { blockers: [], boardLine: null });
});

// --- Roll call ---------------------------------------------------------------
import { parseRollCall as rc } from '../lib/status.mjs';

test('parseRollCall: newest → all ROLL CALL line, agents that said check', () => {
  const board = [
    '- [sneaks → all] general · ROLL CALL · OPEN · 2026-10-25 → [order](orders/a.md) · muse ✓ check 09:00 ET',
    '- [muse → codex] x · not a roll call · muse ✓ check',
    '- [sneaks → all] general · ROLL CALL · OPEN · 2026-10-26 → [order](orders/b.md) · claude-code ✓ check 00:10 ET · Muse ✓ check 00:20 ET · claude-code ✓ check 00:30 ET · paperclip ✓ check'
  ].join('\n');
  const r = rc(board);
  assert.deepEqual(r.checked, ['claude-code', 'muse', 'paperclip']);
  assert.match(r.line, /orders\/b\.md|ROLL CALL/);
  assert.ok(!r.line.includes('](') , 'markdown links stripped');
});

test('parseRollCall: none open, no checks, bad input', () => {
  assert.equal(rc('- [sneaks → all] general · CHECK COMS · OPEN'), null);
  assert.equal(rc(null), null);
  assert.deepEqual(rc('- [claude-code → all] general · ROLL CALL for Sneaks · OPEN').checked, []);
  assert.deepEqual(rc('- [sneaks → all] g · ROLL CALL · grok ✓ checked-out-text · codex ✓  CHECK').checked, ['codex']);
});
