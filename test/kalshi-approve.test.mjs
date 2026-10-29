// Kalshi approval: Face ID -> Ed25519 signature over the exact order the CLI hashes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import {
  approvalMessage, cleanIntent, handleKalshiApprove, loadApproverKey, previewHash, publicKeyB64
} from '../lib/kalshi-approve.mjs';
import { fakeGitHub, makeAuthenticator } from './webauthn-helper.mjs';

const ORIGIN = 'https://coms-pwa.vercel.app';
const SECRET = 's'.repeat(40);
const NOW = Date.parse('2026-10-29T21:00:00Z');
const allow = () => true;
const BUY = { action: 'buy', outcome: 'yes', ticker: 'KXBTC-25NOV02-T100000', count: '10', price: '0.56', time_in_force: 'good_till_canceled', post_only: false };

function testSeed() {
  const { privateKey } = generateKeyPairSync('ed25519');
  const der = privateKey.export({ format: 'der', type: 'pkcs8' });
  return der.subarray(der.length - 32).toString('base64');
}
const post = (body, headers = {}) => new Request(`${ORIGIN}/api/kalshi-approve`, {
  method: 'POST',
  headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', ...headers },
  body: JSON.stringify(body)
});
function setup({ seed = testSeed(), now = NOW } = {}) {
  const auth = makeAuthenticator();
  const gh = fakeGitHub({ board: '# BOARD\n' });
  const env = { SESSION_SECRET: SECRET, GITHUB_TOKEN: 'gh-test-value', OWNER_PASSKEY: auth.ownerPasskey(), KALSHI_APPROVER_PRIVATE_KEY_B64: seed };
  const deps = { fetch: gh.fetchImpl, now, limitApprove: allow };
  const call = async (body, d = deps, h) => { const r = await handleKalshiApprove(post(body, h), env, d); return { status: r.status, body: await r.json() }; };
  return { auth, gh, call, seed, deps };
}
async function approve(s, intent = BUY, mutate = (b) => b) {
  const o = await s.call({ action: 'options', env: 'prod', intent });
  assert.equal(o.status, 200, JSON.stringify(o.body));
  return s.call(mutate({ action: 'approve', env: 'prod', intent, token: o.body.token, assertion: s.auth.assert(o.body.options.challenge) }));
}

test('hash matches kalshi-trader gates.intent_hash exactly (vectors from the Python CLI)', () => {
  assert.equal(previewHash('prod', cleanIntent(BUY)), '692375b1d3f4ee854d4122d702f07f0e2fb53a005da458955985fa3c7df6824c');
  assert.equal(previewHash('prod', cleanIntent({ action: 'sell', outcome: 'no', ticker: 'KX.A_b-1', count: '2.5', price: '0.07', time_in_force: 'fill_or_kill', post_only: true })),
    'd074edfa41b44f94b7336dcc2f9e4fafa4995d384bde510a548f04d83dec31a8');
  assert.equal(previewHash('prod', cleanIntent({ order_id: 'a1b2-c3', ticker: 'KXBTC-25NOV02-T100000' })),
    '5b4b57127489e9990903781da48726caba43f120d17d441831e639f5d77dc0b1');
});

test('Face ID -> signature that verifies with the public key over the CLI message', async () => {
  const s = setup();
  const r = await approve(s);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const hash = previewHash('prod', cleanIntent(BUY));
  assert.equal(r.body.preview_hash, hash);
  assert.equal(r.body.expires_unix, Math.floor(NOW / 1000) + 600);
  const pub = createPublicKey(loadApproverKey(s.seed));
  assert.ok(verify(null, Buffer.from(approvalMessage(hash, r.body.expires_unix)), pub, Buffer.from(r.body.signature_b64, 'base64')));
  assert.equal(r.body.dropPath, `approvals/kalshi/${hash}.sig.json`);
  const drop = JSON.parse(s.gh.files.get(r.body.dropPath).text);
  assert.deepEqual(Object.keys(drop).sort(), ['expires_unix', 'preview_hash', 'signature_b64']);
  assert.equal(publicKeyB64(loadApproverKey(s.seed)).length, 44);
});

test('the response and the drop never contain the private key', async () => {
  const s = setup();
  const r = await approve(s);
  assert.ok(!JSON.stringify(r.body).includes(s.seed));
  for (const [, f] of s.gh.files) assert.ok(!f.text.includes(s.seed));
});

test('order changed after Face ID was requested -> refused, nothing signed', async () => {
  const s = setup();
  const r = await approve(s, BUY, (b) => ({ ...b, intent: { ...BUY, count: '40' } }));
  assert.equal(r.status, 409);
  assert.equal(s.gh.files.size, 1);
});

test('no Face ID / wrong passkey / bad token -> refused', async () => {
  const s = setup();
  const o = await s.call({ action: 'options', env: 'prod', intent: BUY });
  assert.equal((await s.call({ action: 'approve', env: 'prod', intent: BUY, token: o.body.token })).status, 401);
  const other = makeAuthenticator();
  assert.equal((await s.call({ action: 'approve', env: 'prod', intent: BUY, token: o.body.token, assertion: other.assert(o.body.options.challenge) })).status, 401);
  assert.equal((await s.call({ action: 'approve', env: 'prod', intent: BUY, token: 'x.y', assertion: s.auth.assert(o.body.options.challenge) })).status, 401);
  assert.equal(s.gh.files.size, 1);
});

test('expired challenge -> refused', async () => {
  const s = setup();
  const o = await s.call({ action: 'options', env: 'prod', intent: BUY });
  const late = { ...s.deps, now: NOW + 3 * 60e3 };
  const r = await s.call({ action: 'approve', env: 'prod', intent: BUY, token: o.body.token, assertion: s.auth.assert(o.body.options.challenge) }, late);
  assert.equal(r.status, 401);
});

test('over the $25 cap -> not signed, even before Face ID', async () => {
  const s = setup();
  const big = { ...BUY, count: '100', price: '0.50' };
  assert.equal((await s.call({ action: 'options', env: 'prod', intent: big })).status, 422);
});

test('second approval for the same order -> 409 (create-only drop)', async () => {
  const s = setup();
  assert.equal((await approve(s)).status, 200);
  assert.equal((await approve(s)).status, 409);
});

test('bad intents and non-prod are refused', async () => {
  const s = setup();
  for (const intent of [
    { ...BUY, ticker: '../x' }, { ...BUY, ticker: '..' }, { ...BUY, price: '1' }, { ...BUY, price: '0.5e1' },
    { ...BUY, count: '-1' }, { ...BUY, post_only: 'false' }, { ...BUY, extra: 1 }, { ...BUY, ticker: 'é' }
  ]) assert.equal((await s.call({ action: 'options', env: 'prod', intent })).status, 400, JSON.stringify(intent));
  assert.equal((await s.call({ action: 'options', env: 'demo', intent: BUY })).status, 400);
});

test('not set up -> 503; cross-site -> 403', async () => {
  const s = setup({ seed: '' });
  assert.equal((await s.call({ action: 'options', env: 'prod', intent: BUY })).status, 503);
  const s2 = setup();
  assert.equal((await s2.call({ action: 'options', env: 'prod', intent: BUY }, s2.deps, { Origin: 'https://evil.example' })).status, 403);
});
