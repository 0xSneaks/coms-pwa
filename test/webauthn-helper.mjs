// A software passkey for tests: real P-256 keys, real CBOR/COSE encoding and
// real signatures, so @simplewebauthn/server verifies them exactly as it
// would an iPhone's. Flags default to user present + user verified (Face ID).
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';

const b64u = (b) => Buffer.from(b).toString('base64url');
const sha256 = (b) => createHash('sha256').update(b).digest();
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };

export function makeAuthenticator({ rpID = 'coms-pwa.vercel.app', origin = `https://${rpID}` } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credId = randomBytes(16);
  const cose = isoCBOR.encode(new Map([
    [1, 2], [3, -7], [-1, 1],
    [-2, new Uint8Array(Buffer.from(jwk.x, 'base64url'))],
    [-3, new Uint8Array(Buffer.from(jwk.y, 'base64url'))]
  ]));
  let counter = 0;
  const auth = {
    id: b64u(credId),
    register(challenge, { flags = 0x45, clientOrigin = origin } = {}) {
      const authData = Buffer.concat([sha256(rpID), Buffer.from([flags]), u32(0), Buffer.alloc(16),
        Buffer.from([0, credId.length]), credId, Buffer.from(cose)]);
      const attObj = isoCBOR.encode(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', new Uint8Array(authData)]]));
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin: clientOrigin, crossOrigin: false }));
      return { id: auth.id, rawId: auth.id, type: 'public-key', clientExtensionResults: {},
        response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attObj), transports: ['internal'] } };
    },
    // flags 0x05 = UP + UV. Pass 0x01 to simulate "no Face ID".
    assert(challenge, { flags = 0x05, clientOrigin = origin, key = privateKey, rp = rpID } = {}) {
      counter += 1;
      const authData = Buffer.concat([sha256(rp), Buffer.from([flags]), u32(counter)]);
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin: clientOrigin, crossOrigin: false }));
      const signature = sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), key);
      return { id: auth.id, rawId: auth.id, type: 'public-key', clientExtensionResults: {},
        response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authData), signature: b64u(signature) } };
    },
    ownerPasskey() {
      return JSON.stringify({ id: auth.id, publicKey: b64u(cose), counter: 0, transports: ['internal'] });
    },
    otherKey: generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey
  };
  return auth;
}

// In-memory GitHub contents API: create-only semantics without sha, sha
// check with it. Records every call. `boardConflicts` makes the next N
// BOARD.md updates fail with 409 (another agent pushed first).
export function fakeGitHub({ board, boardConflicts = 0 } = {}) {
  const files = new Map([['BOARD.md', { text: board, sha: 'sha0' }]]);
  const calls = [];
  let shaN = 0;
  let conflicts = boardConflicts;
  const reply = (status, body) => new Response(JSON.stringify(body), { status });
  const fetchImpl = async (url, init) => {
    const { pathname } = new URL(url);
    const path = decodeURIComponent(pathname.replace(/^\/repos\/[^/]+\/[^/]+\/contents\//, ''));
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method, path, auth: init.headers.Authorization, body });
    const cur = files.get(path);
    if (init.method === 'GET') {
      return cur ? reply(200, { sha: cur.sha, content: Buffer.from(cur.text).toString('base64') }) : reply(404, {});
    }
    if (init.method === 'PUT') {
      const text = Buffer.from(body.content, 'base64').toString('utf8');
      if (!body.sha) {
        if (cur) return reply(422, { message: 'sha wasn\'t supplied' });
      } else {
        if (path === 'BOARD.md' && conflicts > 0) { conflicts -= 1; files.set(path, { text: cur.text + '\n<!-- other agent -->\n', sha: `other${conflicts}` }); return reply(409, {}); }
        if (!cur || cur.sha !== body.sha) return reply(409, {});
      }
      const sha = `sha${++shaN}`;
      files.set(path, { text, sha });
      return reply(cur ? 200 : 201, { content: { html_url: `https://github.com/x/y/blob/main/${path}` }, commit: { html_url: `https://github.com/x/y/commit/${sha}` } });
    }
    return reply(405, {});
  };
  return { fetchImpl, files, calls };
}
