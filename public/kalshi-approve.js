// Approve one Kalshi prod order with Face ID. The order arrives in the link
// fragment (#i=<base64url JSON intent>), so it never reaches a server log.
// The server re-hashes it, shows the summary, and signs only after Face ID.
// Talks only to /api/kalshi-approve. Everything is rendered as text.
const $ = (s) => document.querySelector(s);
const fromB64u = (s) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
const toB64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const state = (t) => { $('#ka-state').textContent = t; };

async function api(body) {
  let res;
  try {
    res = await fetch('/api/kalshi-approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
  } catch { throw new Error('No connection.'); }
  let data = {};
  try { data = await res.json(); } catch { /* keep {} */ }
  if (!res.ok) throw new Error(data.error || `Server said ${res.status}.`);
  return data;
}

function readIntent() {
  const m = location.hash.match(/^#i=([A-Za-z0-9_-]{1,2000})$/);
  if (!m) return null;
  try { return JSON.parse(new TextDecoder().decode(fromB64u(m[1]))); } catch { return null; }
}

async function main() {
  const intent = readIntent();
  if (!intent) { $('#ka-what').textContent = 'No order in this link.'; return; }
  let opts;
  try { opts = await api({ action: 'options', env: 'prod', intent }); } catch (e) { $('#ka-what').textContent = e.message; return; }
  const s = opts.summary;
  $('#ka-what').textContent = s.what;
  $('#ka-total').textContent = `Max cost incl. est. fee: $${s.total_usd}`;
  $('#ka-tif').textContent = s.time_in_force ? `${s.time_in_force}${s.post_only ? ' · post-only' : ''}` : '';
  $('#ka-hash').textContent = `order hash ${s.preview_hash}`;
  const go = $('#ka-go');
  go.disabled = false;
  go.addEventListener('click', async () => {
    go.disabled = true;
    try {
      // Fresh challenge each tap: the first one may have expired while reading.
      const { options, token } = await api({ action: 'options', env: 'prod', intent });
      if (!window.PublicKeyCredential || !navigator.credentials) throw new Error('This browser has no passkey support.');
      let cred = null;
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
      const out = await api({ action: 'approve', env: 'prod', intent, token, assertion });
      state(`Approved ✓ Saved for Muse at ${out.dropPath}. Valid 10 minutes, once.`);
    } catch (e) { state(e.message); go.disabled = false; }
  });
}
main();
