// Browser side of the locked "Send to crew" and one-time passkey setup.
// Talks only to this site's /api (CSP connect-src 'self'). No secrets live
// here: the passkey's private key never leaves the phone, and the GitHub
// token stays on the server.
const fromB64u = (s) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
const toB64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const MAX_SEND = 2000;

async function post(path, body) {
  let res;
  try {
    res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
  } catch { throw new Error('No connection. Your order was not sent.'); }
  let data = {};
  try { data = await res.json(); } catch { /* keep {} */ }
  if (!res.ok) throw new Error(data.error || `Server said ${res.status}.`);
  return data;
}

export function passkeySupported() {
  return Boolean(window.PublicKeyCredential && navigator.credentials);
}

// -> { orderUrl, commitUrl, boardUpdated, orderPath }
export async function sendOrder({ kind, text, project }) {
  if (!passkeySupported()) throw new Error('This browser has no passkey support. Use Copy instead.');
  if (text.length > MAX_SEND) throw new Error(`Send takes up to ${MAX_SEND.toLocaleString()} characters. Copy works for longer text.`);
  // The exact order goes with the challenge request: the server binds it to
  // this Face ID approval and refuses a different text at send time.
  const { options, token } = await post('/api/order', { action: 'challenge', kind, text, project });
  let cred;
  try {
    cred = await navigator.credentials.get({ publicKey: {
      challenge: fromB64u(options.challenge), rpId: options.rpId, timeout: options.timeout,
      userVerification: 'required',
      allowCredentials: (options.allowCredentials || []).map((c) => ({ type: 'public-key', id: fromB64u(c.id), transports: c.transports }))
    } });
  } catch { throw new Error('Face ID was cancelled or failed. Nothing was sent.'); }
  if (!cred) throw new Error('Face ID was cancelled. Nothing was sent.');
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
  const body = { action: 'send', token, assertion, kind, text, project };
  let result = await post('/api/order', body);
  // Saved but not on the board yet: re-send the SAME approval (same token =
  // same order file), which only adds the missing board line. Never a new order.
  for (let i = 0; i < 2 && !result.boardUpdated; i++) {
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    try { result = await post('/api/order', body); } catch { break; }
  }
  return result;
}

// One-time setup: -> OWNER_PASSKEY value for Vercel (public key, not a secret).
export async function registerOwner(setupCode) {
  if (!passkeySupported()) throw new Error('This browser has no passkey support.');
  const { options, token } = await post('/api/passkey/register', { action: 'options', setupCode });
  let cred;
  try {
    cred = await navigator.credentials.create({ publicKey: {
      challenge: fromB64u(options.challenge), rp: options.rp,
      user: { id: fromB64u(options.user.id), name: options.user.name, displayName: options.user.displayName },
      pubKeyCredParams: options.pubKeyCredParams, timeout: options.timeout,
      attestation: options.attestation, authenticatorSelection: options.authenticatorSelection,
      excludeCredentials: []
    } });
  } catch { throw new Error('Passkey creation was cancelled or failed.'); }
  const r = cred.response;
  const response = {
    id: cred.id, rawId: toB64u(cred.rawId), type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
    response: {
      clientDataJSON: toB64u(r.clientDataJSON), attestationObject: toB64u(r.attestationObject),
      transports: r.getTransports ? r.getTransports() : undefined
    }
  };
  return post('/api/passkey/register', { action: 'verify', setupCode, token, response });
}
