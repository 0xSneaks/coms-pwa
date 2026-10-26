// Roll call page: start (Face ID) -> sent -> live list of who said check.
// Talks only to /api/rollcall (CSP connect-src 'self'). Board text is never
// rendered as HTML; only agent ids/times from the server, as text.
const $ = (s) => document.querySelector(s);
const POLL_MS = 20_000;
const fromB64u = (s) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
const toB64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let crew = [];
let watch = null;
let timer = null;

async function api(body) {
  let res;
  try {
    res = await fetch('/api/rollcall', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
  } catch { throw new Error('No connection.'); }
  let data = {};
  try { data = await res.json(); } catch { /* keep {} */ }
  if (!res.ok) { const e = new Error(data.error || `Server said ${res.status}.`); e.status = res.status; throw e; }
  return data;
}

async function faceId(mode) {
  if (!window.PublicKeyCredential || !navigator.credentials) throw new Error('This browser has no passkey support.');
  const { options, token } = await api({ action: 'options', mode });
  let cred;
  try {
    cred = await navigator.credentials.get({ publicKey: {
      challenge: fromB64u(options.challenge), rpId: options.rpId, timeout: options.timeout, userVerification: 'required',
      allowCredentials: (options.allowCredentials || []).map((c) => ({ type: 'public-key', id: fromB64u(c.id), transports: c.transports }))
    } });
  } catch { cred = null; }
  if (!cred) throw new Error('Face ID was cancelled.');
  const r = cred.response;
  const assertion = {
    id: cred.id, rawId: toB64u(cred.rawId), type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment || undefined,
    clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
    response: { clientDataJSON: toB64u(r.clientDataJSON), authenticatorData: toB64u(r.authenticatorData),
      signature: toB64u(r.signature), userHandle: r.userHandle ? toB64u(r.userHandle) : undefined }
  };
  return api({ action: 'unlock', mode, token, assertion });
}

function render(rc) {
  const list = $('#rc-list');
  list.textContent = '';
  const said = new Map((rc?.checked || []).map((c) => [c.id, c.at]));
  let yes = 0;
  for (const a of crew) {
    const keys = [a.id.toLowerCase(), a.name.toLowerCase()];
    const hit = keys.find((k) => said.has(k));
    const li = document.createElement('li');
    const name = document.createElement('span'); name.textContent = a.name;
    const mark = document.createElement('span'); mark.className = 'mark';
    if (hit !== undefined) { yes++; li.className = 'ok'; mark.textContent = `✓ check${said.get(hit) ? ` · ${said.get(hit)}` : ''}`; }
    else mark.textContent = 'waiting…';
    li.append(name, mark);
    list.append(li);
  }
  $('#rc-count').hidden = false;
  $('#rc-count').textContent = rc ? `${yes} of ${crew.length} said check` : 'No roll call on the board yet.';
  $('#rc-date').textContent = rc?.date || '';
}

async function poll() {
  if (!watch) return;
  try {
    const { rollCall } = await api({ action: 'poll', watch });
    render(rollCall);
    $('#rc-state').textContent = `Live · updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  } catch (e) {
    if (e.status === 401) { stop('Live view ended (30 min). Tap "Just show who said check" to look again.'); return; }
    $('#rc-state').textContent = `${e.message} Retrying…`;
  }
}

function stop(msg) { clearInterval(timer); timer = null; watch = null; $('#rc-state').textContent = msg; }

function startWatching(pass) {
  watch = pass;
  clearInterval(timer);
  poll();
  timer = setInterval(poll, POLL_MS);
}

async function run(mode) {
  const go = $('#rc-start'), look = $('#rc-watch');
  go.disabled = look.disabled = true;
  $('#rc-state').textContent = 'Waiting for Face ID…';
  try {
    const r = await faceId(mode);
    if (mode === 'start') {
      $('#rc-state').textContent = r.boardUpdated
        ? 'Roll call sent. Answers show up below as agents check in.'
        : "Saved, but NOT on the board yet. Don't tap again; ask an agent to add the board line.";
    }
    startWatching(r.watch);
  } catch (e) {
    $('#rc-state').textContent = e.message || 'Something went wrong.';
  } finally {
    go.disabled = look.disabled = false;
  }
}

async function init() {
  try {
    const data = await (await fetch('./crew.json')).json();
    crew = (data.agents || []).map((a) => ({ id: String(a.id), name: String(a.name || a.id) }));
  } catch { crew = []; }
  render(null);
  $('#rc-count').hidden = true;
  $('#rc-start').addEventListener('click', () => run('start'));
  $('#rc-watch').addEventListener('click', () => run('watch'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && watch) poll(); });
}
init();
