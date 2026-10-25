// Browser side of the locked, read-only "Crew status" view. Same passkey as
// "Send to crew" (see public/send.js), but this only ever reads: the server
// answers with a small digest of the AI COMS board and nothing is written.
// Talks only to this site's /api (CSP connect-src 'self').
const fromB64u = (s) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
const toB64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function post(path, body) {
  let res;
  try {
    res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
  } catch { throw new Error('No connection. Status stayed locked.'); }
  let data = {};
  try { data = await res.json(); } catch { /* keep {} */ }
  if (!res.ok) throw new Error(data.error || `Server said ${res.status}.`);
  return data;
}

export function passkeySupported() {
  return Boolean(window.PublicKeyCredential && navigator.credentials);
}

// -> { lastOrder, latestHandoff, blockers, boardLine } (see lib/status.mjs)
export async function fetchStatus() {
  if (!passkeySupported()) throw new Error('This browser has no passkey support.');
  const { options, token } = await post('/api/status', { action: 'options' });
  let cred;
  try {
    cred = await navigator.credentials.get({ publicKey: {
      challenge: fromB64u(options.challenge), rpId: options.rpId, timeout: options.timeout,
      userVerification: 'required',
      allowCredentials: (options.allowCredentials || []).map((c) => ({ type: 'public-key', id: fromB64u(c.id), transports: c.transports }))
    } });
  } catch { throw new Error('Face ID was cancelled or failed. Status stayed locked.'); }
  if (!cred) throw new Error('Face ID was cancelled. Status stayed locked.');
  const r = cred.response;
  const assertion = {
    id: cred.id, rawId: toB64u(cred.rawId), type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment || undefined,
    clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
    response: {
      clientDataJSON: toB64u(r.clientDataJSON), authenticatorData: toB64u(r.authenticatorData),
      signature: toB64u(r.signature), userHandle: r.userHandle ? toB64u(r.userHandle) : undefined
    }
  };
  return post('/api/status', { action: 'view', token, assertion });
}

// --- Dialog wiring (self-contained: app.js owns the other dialogs) ---

// Plain text only: board content is remote text and is never set as HTML.
function renderStatus(bodyEl, d) {
  bodyEl.textContent = '';
  const add = (text) => {
    const span = document.createElement('span');
    span.style.display = 'block';
    span.textContent = text;
    bodyEl.appendChild(span);
  };
  add(d.lastOrder
    ? `Last order: ${d.lastOrder.title || d.lastOrder.name}${d.lastOrder.kind ? ` · ${d.lastOrder.kind}` : ''}${d.lastOrder.status ? ` · ${d.lastOrder.status}` : ''}`
    : 'Last order: none yet.');
  add(d.latestHandoff
    ? `Latest handoff: ${d.latestHandoff.agent} · ${d.latestHandoff.project} · ${d.latestHandoff.when}`
    : 'Latest handoff: none yet.');
  if (Array.isArray(d.blockers) && d.blockers.length) {
    add('Blockers:');
    for (const b of d.blockers) add(`• ${b}`);
  } else {
    add('Blockers: none on the board.');
  }
  if (d.boardLine) add(`Latest board line: ${d.boardLine}`);
}

function initStatus() {
  const open = document.querySelector('#status-open');
  const dialog = document.querySelector('#status-dialog');
  if (!open || !dialog) return;
  const bodyEl = dialog.querySelector('#status-body');
  const show = dialog.querySelector('#status-show');
  const error = dialog.querySelector('#status-error');
  const close = dialog.querySelector('.close-dialog');
  open.addEventListener('click', () => { if (typeof dialog.showModal === 'function') dialog.showModal(); });
  if (close) close.addEventListener('click', () => dialog.close());
  if (!show) return;
  show.addEventListener('click', async () => {
    error.textContent = '';
    show.disabled = true;
    try {
      renderStatus(bodyEl, await fetchStatus());
    } catch (e) {
      error.textContent = e && e.message ? e.message : 'Something went wrong.';
    } finally {
      show.disabled = false;
    }
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initStatus);
  else initStatus();
}
