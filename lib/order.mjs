// Turning a passkey-verified order into an AI COMS board entry.
//
// Two writes to the board repo (default 0xSneaks/ai-coms):
//   1. orders/<YYYY-MM-DD>_<HHMM>_<nonce>.md  — created only if absent (replay guard)
//   2. BOARD.md — one "📨 Requests" line: [sneaks → all], so every agent's inbox
//      (`tools/coms_check.py --inbox <agent>`) picks it up.
// BOARD.md changes concurrently (other agents push), so the update retries on
// a stale sha. If the board update still fails, the order file stands on its
// own and the response says so.
import { createHash } from 'node:crypto';
import { composeCommand } from '../public/commands.js';

export const MAX_TEXT = 2000;
export const KINDS = { check: 'CHECK COMS', react: 'REACT', review: 'REVIEW AND BREAK DOWN' };
const API = 'https://api.github.com';

// C0/C1 controls except \t and \n, line/paragraph separators, bidi overrides.
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

// Control characters out (newline and tab stay), length capped. Throws on bad input.
export function cleanInput({ kind, text = '', project = 'general' }) {
  if (!Object.hasOwn(KINDS, kind)) throw new InputError('unknown command');
  if (typeof text !== 'string') throw new InputError('text must be a string');
  const cleaned = text.replace(/\r\n?/g, '\n').replace(CONTROL, '').trim();
  if (cleaned.length > MAX_TEXT) throw new InputError(`text is longer than ${MAX_TEXT} characters`);
  if (kind !== 'check' && !cleaned) throw new InputError('add some text first');
  const proj = project == null || project === '' ? 'general' : project;
  if (typeof proj !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(proj)) throw new InputError('project must be a short slug');
  return { kind, text: cleaned, project: proj };
}

export class InputError extends Error {}

// Fingerprint of the exact order. The challenge carries it, so one Face ID
// approval is good for this text only.
export function orderHash({ kind, text, project }) {
  return createHash('sha256').update(JSON.stringify([kind, text, project])).digest('base64url');
}

// US Eastern, like every other AI COMS timestamp.
export function etParts(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour}${p.minute}`, time: `${p.hour}:${p.minute}` };
}

export function summaryOf({ kind, text }) {
  const one = text.replace(/\s+/g, ' ').replace(/`/g, "'").trim();
  const head = one.length > 140 ? `${one.slice(0, 139)}…` : one;
  return head ? `${KINDS[kind]}: ${head}` : KINDS[kind];
}

export function buildOrder(input, nonce, now) {
  const t = etParts(now);
  const path = `orders/${t.date}_${t.hhmm}_${nonce}.md`;
  const command = composeCommand(input.kind, input.text);
  const quoted = command.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n');
  const file = [
    `# Order — sneaks → all — ${t.date} ${t.time} ET`,
    '',
    `**From:** Sneaks, verified by Face ID passkey in coms-pwa · **Kind:** ${KINDS[input.kind]} · **Project:** ${input.project}`,
    '**Status:** OPEN. Every agent: handle it per RULE.md v2 and mark your part in your sign-off.',
    '',
    quoted,
    ''
  ].join('\n');
  const line = `- [sneaks → all] ${input.project} · ${summaryOf(input)} · OPEN · ${t.date} → [order](${path})`;
  return { path, file, line, date: t.date };
}

// Insert the request line at the end of the "📨 Requests" section. Refuses to
// guess if the board layout isn't the one it knows.
export function insertRequest(board, line) {
  const start = board.search(/^## 📨 Requests[^\n]*$/m);
  if (start < 0) throw new Error('BOARD.md has no "📨 Requests" section');
  const rest = board.slice(start);
  const endRel = rest.search(/\n---\s*\n|\n## /);
  const end = endRel < 0 ? board.length : start + endRel;
  const section = board.slice(start, end).replace(/\s+$/, '');
  return `${board.slice(0, start)}${section}\n${line}\n${board.slice(end)}`;
}

function gh(fetchImpl, token) {
  return async (method, path, body) => {
    const res = await fetchImpl(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'coms-pwa',
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    let json = null;
    try { json = await res.json(); } catch { /* empty body */ }
    return { status: res.status, json };
  };
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

// -> { orderPath, orderUrl, boardUpdated, repaired, commitUrl } ; throws GitHubError.
//
// The order path comes only from signed token data (issue time + nonce), so
// re-sending the same Face ID approval always hits the same file. If that
// file already exists:
//   - its board line is present  -> 409 "already sent" (replay, nothing new)
//   - its board line is missing  -> add it now (repair of an earlier partial
//     send; still exactly one order, and the line is never added twice)
export async function writeOrder({ fetchImpl, token, repo, order, maxRetries = 3 }) {
  const call = gh(fetchImpl, token);
  const created = await call('PUT', `/repos/${repo}/contents/${order.path}`, {
    message: `coms: order from sneaks via coms-pwa (${order.date})`,
    content: b64(order.file)
  });
  const exists = created.status === 422 || created.status === 409;
  if (!exists && created.status !== 201) throw new GitHubError(502, `GitHub refused the order file (${created.status})`);
  let orderUrl = created.json?.content?.html_url;
  if (exists) {
    // GitHub also uses 422 for validation failures: never treat it as proof
    // that an order was saved. A retry may repair the board only if the
    // existing file matches the exact passkey-approved order content.
    const prior = await call('GET', `/repos/${repo}/contents/${order.path}`);
    if (prior.status !== 200 || typeof prior.json?.content !== 'string') {
      throw new GitHubError(502, 'GitHub did not confirm an existing order; nothing was added to the board');
    }
    const stored = Buffer.from(prior.json.content.replace(/\\s/g, ''), 'base64').toString('utf8');
    if (stored !== order.file) {
      throw new GitHubError(409, 'order path occupied by different content; nothing was added to the board');
    }
    orderUrl = prior.json.html_url;
  }

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const cur = await call('GET', `/repos/${repo}/contents/BOARD.md`);
    if (cur.status !== 200 || !cur.json?.sha) break;
    const board = Buffer.from(cur.json.content || '', 'base64').toString('utf8');
    if (board.includes(`](${order.path})`)) {
      if (exists) throw new GitHubError(409, 'this order was already sent');
      return { orderPath: order.path, orderUrl, boardUpdated: true, repaired: false };
    }
    let next;
    try { next = insertRequest(board, order.line); } catch { break; }
    const put = await call('PUT', `/repos/${repo}/contents/BOARD.md`, {
      message: `coms: [sneaks → all] order via coms-pwa (${order.date})`,
      content: b64(next),
      sha: cur.json.sha
    });
    if (put.status === 200 || put.status === 201) {
      return { orderPath: order.path, orderUrl, boardUpdated: true, repaired: exists, commitUrl: put.json?.commit?.html_url };
    }
    if (put.status !== 409 && put.status !== 422) break; // not a stale-sha race
  }
  if (exists) throw new GitHubError(502, 'order already saved, but the board line still could not be added; try again');
  return { orderPath: order.path, orderUrl, boardUpdated: false, repaired: false, commitUrl: created.json?.commit?.html_url };
}

export class GitHubError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
