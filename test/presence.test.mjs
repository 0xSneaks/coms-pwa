// Public crew presence: parsing, DST-aware ET times, state windows, request
// guards, caching, fail-soft (mocked GitHub; never hits the network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPresence, crewIdFor, etToDate, handlePresence, parseClaims, parseLatest,
  resetPresenceCache, stateFor
} from '../lib/presence.mjs';

const ORIGIN = 'https://coms-pwa.vercel.app';
const ENV = { GITHUB_TOKEN: 'test-token-value-never-echoed' };
const NOW = Date.parse('2026-11-02T04:30:00Z'); // 23:30 ET (EST)
const BOARD = `# BOARD

## 🔒 Active claims

- [claude-code] coms-pwa · presence API · started 2026-11-01 23:20 ET
- ~~[claude] gta6ismogged · lane/8 · started 2026-11-01 08:45 ET~~ RELEASED
- [muse] fomo-monitor · undated old claim
- [codex] musepad · stale · started 2026-10-25 11:15 ET

## 📨 Requests (agent → agent)

- [claude → muse] gta6 · ask · OPEN · 2026-11-01

## 📬 Latest handoffs (newest first, keep last 10)
- VERIFIED · 2026-11-01 23:25 ET · claude · gta6ismogged · director decisions recorded
- VERIFIED · 2026-11-01 ~18:00 ET · muse · general · rundown for claude
- VERIFIED · 2026-11-01 17:00 ET · claude · old · older line ignored

## 📁 Projects
`;
const NAMES = [
  '2026-11-01_2240_muse_da-city-lane-locks.md',
  '2026-11-01_2300_blue-3_perf.md',
  '2026-10-25_0109_grok_coms-pwa-art.md',
  '2026-11-01_2324_grok-bot_justmogit.md',
  '2026-11-01_2235_claude_da-city-director.md',
  'README.md', '2026-11-01_blue-3_perf-390.png'
];

test('crewIdFor maps board tags onto roster ids', () => {
  assert.equal(crewIdFor('Claude-Code'), 'claude-code');
  assert.equal(crewIdFor('blue-3'), 'muse-blue');
  assert.equal(crewIdFor('muse-blue-rollcall'), 'muse-blue');
  assert.equal(crewIdFor('paperclip-vm'), 'claude-code (paperclip-vm)');
  assert.equal(crewIdFor('grok-bot'), 'grok-bot');
  assert.equal(crewIdFor('grok'), 'grok');
  assert.equal(crewIdFor('deepseek'), null);
  assert.equal(crewIdFor(''), null);
});

test('etToDate is DST-aware for America/New_York', () => {
  assert.equal(etToDate('2026-11-01', '22:55').toISOString(), '2026-11-02T03:55:00.000Z'); // EST
  assert.equal(etToDate('2026-10-25', '01:30').toISOString(), '2026-10-25T05:30:00.000Z'); // EDT
  assert.equal(etToDate('2026-13-01', '22:55'), null);
  assert.equal(etToDate('2026-11-01', 'late'), null);
});

test('claims skip struck-through and undated lines, keep dates', () => {
  const c = parseClaims(BOARD);
  assert.deepEqual(Object.keys(c).sort(), ['claude-code', 'codex']);
  assert.equal(c['claude-code'].project, 'coms-pwa');
  assert.equal(c['claude-code'].text, 'presence API');
});

test('latest handoffs: newest line per agent wins, ~times parse', () => {
  const l = parseLatest(BOARD);
  assert.equal(l.claude.summary, 'director decisions recorded');
  assert.equal(l.claude.at.toISOString(), '2026-11-02T04:25:00.000Z');
  assert.equal(l.muse.project, 'general');
});

test('state windows', () => {
  const at = (min) => new Date(NOW - min * 60e3);
  assert.equal(stateFor(at(10), false, NOW), 'live');
  assert.equal(stateFor(at(60), false, NOW), 'active');
  assert.equal(stateFor(at(600), true, NOW), 'active');
  assert.equal(stateFor(at(600), false, NOW), 'idle');
  assert.equal(stateFor(at(3000), false, NOW), 'away');
  assert.equal(stateFor(null, false, NOW), 'away');
});

test('buildPresence merges filenames, latest lines and claims', () => {
  const { agents } = buildPresence(NAMES, BOARD, NOW);
  assert.equal(agents.claude.state, 'live');
  assert.equal(agents.claude.project, 'gta6ismogged');
  assert.equal(agents['claude-code'].state, 'live'); // claim started 23:20
  assert.match(agents['claude-code'].claim, /coms-pwa · presence API/);
  assert.equal(agents['muse-blue'].state, 'active'); // 23:00 handoff
  assert.equal(agents.muse.state, 'active');
  assert.equal(agents.grok.state, 'away');
  assert.equal(agents['grok-bot'].state, 'live');
  assert.equal(agents['grok-bot'].project, 'justmogit');
  assert.equal(agents.codex.claim, null); // stale claim dropped
  assert.equal(agents.codex.state, 'away');
});

const req = (headers = {}, method = 'GET') => new Request(`${ORIGIN}/api/presence`, { method, headers });
function mockGitHub(calls) {
  return async (url, init) => {
    calls.push(url);
    assert.equal(init.headers.Authorization, `Bearer ${ENV.GITHUB_TOKEN}`);
    if (url.endsWith('/contents/handoffs')) return Response.json(NAMES.map((name) => ({ name, type: 'file' })));
    if (url.endsWith('/contents/BOARD.md')) return new Response(BOARD);
    return new Response('nope', { status: 404 });
  };
}

test('handler: same-origin GET, cached, no token leak', async () => {
  resetPresenceCache();
  const calls = [];
  const deps = { now: NOW, fetchImpl: mockGitHub(calls), limit: () => true };
  const res = await handlePresence(req({ 'sec-fetch-site': 'same-origin' }), ENV, deps);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes(ENV.GITHUB_TOKEN));
  assert.equal(JSON.parse(text).agents.claude.state, 'live');
  assert.equal(calls.length, 2);
  const again = await handlePresence(req(), ENV, { ...deps, now: NOW + 5e3 });
  assert.equal(again.status, 200);
  assert.equal(calls.length, 2, 'served from cache');
});

test('handler: refuses cross-site, wrong origin, non-GET, missing token', async () => {
  resetPresenceCache();
  const deps = { now: NOW, fetchImpl: mockGitHub([]), limit: () => true };
  assert.equal((await handlePresence(req({ 'sec-fetch-site': 'cross-site' }), ENV, deps)).status, 403);
  assert.equal((await handlePresence(req({ origin: 'https://evil.example' }), ENV, deps)).status, 403);
  assert.equal((await handlePresence(req({}, 'POST'), ENV, deps)).status, 405);
  assert.equal((await handlePresence(req(), {}, deps)).status, 503);
});

test('handler: fails soft when GitHub is down', async () => {
  resetPresenceCache();
  const down = async () => new Response('down', { status: 500 });
  const res = await handlePresence(req(), ENV, { now: NOW, fetchImpl: down, limit: () => true });
  assert.equal(res.status, 502);
  const boom = async () => { throw new Error('net'); };
  assert.equal((await handlePresence(req(), ENV, { now: NOW, fetchImpl: boom, limit: () => true })).status, 502);
});
