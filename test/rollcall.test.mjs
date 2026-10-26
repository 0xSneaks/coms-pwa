// Roll call: one screen, whole loop — Face ID start writes one ROLL CALL
// order, the watch pass polls who said check, and the pass can't do more.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRollCall, parseRollCall, WATCH_TTL_MS } from '../lib/rollcall.mjs';
import { signToken } from '../lib/challenge-token.mjs';
import { fakeGitHub, makeAuthenticator } from './webauthn-helper.mjs';

const ORIGIN = 'https://coms-pwa.vercel.app';
const SECRET = 's'.repeat(40);
const BOARD = `# BOARD

## 📨 Requests (agent → agent)

_Format: \`- [from → to] project · ask · OPEN · date → [note](handoffs/...)\`_

- [muse → claude-code] p · a · OPEN · 2026-10-24 → [note](handoffs/x.md)

---

## 📬 Latest handoffs (newest first, keep last 10)
`;
const NOW = Date.parse('2026-10-26T05:00:00Z');
const allow = () => true;
const post = (body, headers = {}) => new Request(`${ORIGIN}/api/rollcall`, {
  method: 'POST',
  headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', ...headers },
  body: JSON.stringify(body)
});

function setup(now = NOW) {
  const auth = makeAuthenticator();
  const gh = fakeGitHub({ board: BOARD });
  const env = { SESSION_SECRET: SECRET, GITHUB_TOKEN: 'gh-test-value', OWNER_PASSKEY: auth.ownerPasskey() };
  const deps = { fetch: gh.fetchImpl, now, limitUnlock: allow, limitPoll: allow };
  const call = async (body, d = deps) => { const r = await handleRollCall(post(body), env, d); return { status: r.status, body: await r.json() }; };
  return { auth, gh, call, deps };
}

async function unlock(s, mode) {
  const o = await s.call({ action: 'options', mode });
  assert.equal(o.status, 200);
  assert.equal(o.body.options.userVerification, 'required');
  return s.call({ action: 'unlock', mode, token: o.body.token, assertion: s.auth.assert(o.body.options.challenge) });
}

test('start: Face ID -> one ROLL CALL order on the board + a watch pass', async () => {
  const s = setup();
  const r = await unlock(s, 'start');
  assert.equal(r.status, 200);
  assert.equal(r.body.sent, true);
  assert.equal(r.body.boardUpdated, true);
  assert.ok(r.body.watch);
  const board = s.gh.files.get('BOARD.md').text;
  assert.ok(board.includes('- [sneaks → all] general · ROLL CALL · OPEN'));
  assert.equal([...s.gh.files.keys()].filter((k) => k.startsWith('orders/')).length, 1);
});

test('the loop closes: agents append ✓ check, poll ticks them off', async () => {
  const s = setup();
  const { body } = await unlock(s, 'start');
  const f = s.gh.files.get('BOARD.md');
  f.text = f.text.replace(/(ROLL CALL · OPEN[^\n]*)/, '$1 · claude-code ✓ check 01:05 ET · Muse ✓ check 01:20 ET');
  const p = await s.call({ action: 'poll', watch: body.watch });
  assert.equal(p.status, 200);
  assert.deepEqual(p.body.rollCall.checked, [{ id: 'claude-code', at: '01:05' }, { id: 'muse', at: '01:20' }]);
  assert.equal(p.body.rollCall.date, '2026-10-26');
});

test('watch mode: Face ID gives a pass, sends nothing', async () => {
  const s = setup();
  const r = await unlock(s, 'watch');
  assert.equal(r.status, 200);
  assert.ok(r.body.watch);
  assert.equal(r.body.sent, undefined);
  assert.equal([...s.gh.files.keys()].filter((k) => k.startsWith('orders/')).length, 0);
});

test('watch pass: read-only, expires after 30 min, cannot be used as a challenge', async () => {
  const s = setup();
  const { body } = await unlock(s, 'watch');
  const late = await s.call({ action: 'poll', watch: body.watch }, { ...s.deps, now: NOW + WATCH_TTL_MS + 1000 });
  assert.equal(late.status, 401);
  const misuse = await s.call({ action: 'unlock', mode: 'start', token: body.watch, assertion: {} });
  assert.equal(misuse.status, 401);
  assert.equal((await s.call({ action: 'poll', watch: 'forged.token' })).status, 401);
  const challengeAsPass = signToken(SECRET, { purpose: 'rollcall-start', challenge: 'x', now: NOW });
  assert.equal((await s.call({ action: 'poll', watch: challengeAsPass })).status, 401);
});

test('refusals: no Face ID, wrong passkey, wrong mode, cross-site', async () => {
  const s = setup();
  const o = await s.call({ action: 'options', mode: 'start' });
  assert.equal((await s.call({ action: 'unlock', mode: 'start', token: o.body.token })).status, 401);
  const other = makeAuthenticator();
  assert.equal((await s.call({ action: 'unlock', mode: 'start', token: o.body.token, assertion: other.assert(o.body.options.challenge) })).status, 401);
  // a start challenge can't be redeemed as a watch (purpose-bound)
  assert.equal((await s.call({ action: 'unlock', mode: 'watch', token: o.body.token, assertion: s.auth.assert(o.body.options.challenge) })).status, 401);
  assert.equal((await s.call({ action: 'options', mode: 'nope' })).status, 400);
  const r = await handleRollCall(post({ action: 'options', mode: 'start' }, { 'Sec-Fetch-Site': 'cross-site' }), { SESSION_SECRET: SECRET }, {});
  assert.equal(r.status, 403);
  assert.equal([...s.gh.files.keys()].filter((k) => k.startsWith('orders/')).length, 0);
});

test('replay: the same Face ID approval cannot send a second roll call', async () => {
  const s = setup();
  const o = await s.call({ action: 'options', mode: 'start' });
  const assertion = s.auth.assert(o.body.options.challenge);
  assert.equal((await s.call({ action: 'unlock', mode: 'start', token: o.body.token, assertion })).status, 200);
  const again = await s.call({ action: 'unlock', mode: 'start', token: o.body.token, assertion });
  assert.notEqual(again.status, 200);
  assert.equal(s.gh.files.get('BOARD.md').text.match(/ROLL CALL/g).length, 1);
});

test('parseRollCall: newest → all line only, first answer wins, bad input', () => {
  const b = [
    '- [sneaks → all] g · ROLL CALL · OPEN · 2026-10-25 → [order](orders/a.md) · muse ✓ check 09:00 ET',
    '- [muse → codex] x · ROLL CALL · grok ✓ check',
    '- [sneaks → all] g · ROLL CALL · OPEN · 2026-10-26 → [order](orders/b.md) · codex ✓ check 00:10 ET · Codex ✓ check 00:30 ET · paperclip ✓ check'
  ].join('\n');
  assert.deepEqual(parseRollCall(b), { date: '2026-10-26', checked: [{ id: 'codex', at: '00:10' }, { id: 'paperclip', at: null }] });
  assert.equal(parseRollCall('- [sneaks → all] g · CHECK COMS · OPEN'), null);
  assert.equal(parseRollCall(null), null);
});
