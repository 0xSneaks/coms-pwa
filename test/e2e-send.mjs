// End-to-end check of the real browser code (public/send.js, app.js,
// setup.js) against the real handlers, in Chromium with a virtual
// platform authenticator (user verification on = "Face ID passed").
// GitHub is faked in-process; nothing leaves the machine.
//
//   node test/e2e-send.mjs        (needs the `playwright` package + Chromium)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { handleOrder, handleRegister } from '../lib/handlers.mjs';
import { fakeGitHub } from './webauthn-helper.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const BOARD = '# BOARD\n\n## 📨 Requests (agent → agent)\n\n- [a → b] p · x · OPEN · 2026-10-24\n\n---\n';

const gh = fakeGitHub({ board: BOARD });
const env = { SESSION_SECRET: 'e'.repeat(40), SETUP_CODE: 'setup-e2e-code', GITHUB_TOKEN: 'fake', RP_ID: 'localhost' };
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, env.ORIGIN);
  if (url.pathname.startsWith('/api/')) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const request = new Request(url, { method: req.method, headers: req.headers, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined });
    const handler = url.pathname === '/api/order' ? handleOrder : handleRegister;
    const out = await handler(request, env, { fetch: gh.fetchImpl, limit: () => true, limitChallenge: () => true, limitSend: () => true });
    res.writeHead(out.status, Object.fromEntries(out.headers)); res.end(Buffer.from(await out.arrayBuffer()));
    return;
  }
  const path = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  try { const body = await readFile(join(PUBLIC, path)); res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
env.ORIGIN = `http://localhost:${server.address().port}`;

const browser = await chromium.launch();
try {
  const page = await (await browser.newContext()).newPage();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true } });

  // 1. One-time setup page creates the passkey and shows OWNER_PASSKEY.
  await page.goto(`${env.ORIGIN}/setup.html`);
  await page.fill('#setup-code', 'setup-e2e-code');
  await page.click('#create-passkey');
  await page.waitForFunction(() => document.querySelector('#owner-passkey').value.length > 20, null, { timeout: 15000 });
  const owner = await page.inputValue('#owner-passkey');
  check('setup page registers a passkey', JSON.parse(owner).id.length > 10);
  env.OWNER_PASSKEY = owner; // what Sneaks pastes into Vercel

  // 2. The main app sends a REACT order with Face ID.
  await page.goto(`${env.ORIGIN}/`);
  await page.fill('#command-input', 'E2E: wire the relay');
  await page.click('[data-command="react"]');
  const visible = await page.inputValue('#command-output');
  check('command box shows its own part first', visible.split('\n').slice(0, 4).join(' ').includes('E2E: wire the relay'));
  await page.click('#send-command');
  await page.waitForFunction(() => /Sent to the crew|failed|cancel|not/i.test(document.querySelector('#send-status').textContent), null, { timeout: 15000 });
  const status = await page.textContent('#send-status');
  check('Send to crew succeeds', status.includes('Sent to the crew'), status.trim());
  const orders = [...gh.files.keys()].filter((k) => k.startsWith('orders/'));
  const board = gh.files.get('BOARD.md').text;
  check('order file + board line written', orders.length === 1 && board.includes('- [sneaks → all] general · REACT: E2E: wire the relay · OPEN'));

  // 3. Face ID fails (user not verified): nothing is sent.
  await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false });
  const before = gh.calls.length;
  await page.click('#send-command'); // dialog is still open from step 2
  await page.waitForFunction(() => { const t = document.querySelector('#send-status').textContent; return t && !/Waiting/.test(t); }, null, { timeout: 20000 });
  check('Face ID fails -> nothing written', gh.calls.length === before, (await page.textContent('#send-status')).trim());

} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((ok) => !ok).length;
console.log(`E2E: ${failed ? 'FAIL' : 'PASS'} (${results.length - failed}/${results.length})`);
process.exit(failed ? 1 : 0);
