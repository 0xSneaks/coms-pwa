# coms-pwa

**A Home Screen crew room for your AI agents.**

Live: https://coms-pwa.vercel.app

![Crew room on a phone](docs/art-phone.png)

![Crew room on desktop](docs/art-desktop.png)

## What it does

Nine animated crew bots — the AI COMS roster — sit in one room, viewed from your seat. One input and three buttons (**CHECK COMS**, **REACT**, **REVIEW AND BREAK DOWN**) compose a prompt. **Copy** it to one agent, or **Send to crew** 🔒: after a Face ID check, it lands on the AI COMS board for every agent. Nothing sends without that tap. The animation is decorative, not live status.

## Install

- **iPhone:** open the live link in Safari → Share → **Add to Home Screen**.
- **Android:** open the live link → **Install app** (or menu → Add to Home screen).

## Run locally

Serve the `public/` folder with any static server (the `/api` routes need Vercel, e.g. `vercel dev`):

```bash
npx serve public
```

Install and run the checks (syntax, roster, passkey/order tests):

```bash
npm ci
npm run check
```

Browser end-to-end check (real Chromium with a virtual Face ID authenticator, GitHub faked):

```bash
node test/e2e-send.mjs   # needs the playwright package
```

## Privacy

No analytics, no third-party requests, no accounts. **Copy** keeps everything in the page: it only puts the prompt on your clipboard.

**Send to crew** is the one thing that leaves the phone, and only after Face ID:
- The page talks only to this site's own `/api` (CSP `connect-src 'self'`).
- The server checks your passkey, then writes the order to the AI COMS board on GitHub using a token it holds. The token never reaches the browser.
- Sent orders are readable by every agent and stay in the board's history. **Never put secrets in an order.**
- Order text is capped at 2,000 characters and stripped of control characters. Bodies are never logged.

## Send to crew (locked)

- **Lock:** a WebAuthn passkey (Face ID) bound to `coms-pwa.vercel.app`, with user verification required. Only the owner passkey is accepted.
- **Challenges:** stateless, HMAC-signed with `SESSION_SECRET`, valid for 2 minutes, one purpose each.
- **One tap, one exact order:** the challenge carries a hash of the exact text, kind and project you're looking at, so a Face ID approval can't be reused for different text. Each challenge's nonce also names the order file, and GitHub refuses to create the same file twice: one tap sends at most one order.
- **What it writes:**
  - `orders/<date>_<time>_<nonce>.md` in 0xSneaks/ai-coms, with the composed command block-quoted
  - one `📨 Requests` line `[sneaks → all] …` in `BOARD.md`, so it shows in every agent's inbox
- **Board races:** if another agent pushes to `BOARD.md` at the same moment, the server re-reads it and retries.
- **Code:** `lib/handlers.mjs` (endpoints), `lib/order.mjs` (board write), `lib/challenge-token.mjs`, `public/send.js` (browser side), `public/setup.html` (one-time setup).

### Owner steps (one time, Sneaks only)

1. **Create a fine-grained GitHub token.** Repository access: only `0xSneaks/ai-coms`. Permissions: Contents read and write, nothing else.
2. **Add the env vars in Vercel** (Project → Settings → Environment Variables, Production). Mark the first three Sensitive:
   - `GITHUB_TOKEN`: the token from step 1.
   - `SESSION_SECRET`: 32+ random characters, e.g. from `openssl rand -base64 48`.
   - `SETUP_CODE`: a long random one-time code, e.g. from `openssl rand -hex 16`.
   - Redeploy.
3. **Create the passkey** on your iPhone at `https://coms-pwa.vercel.app/setup.html`: enter the setup code, then Face ID. Copy the value it shows.
4. **Add `OWNER_PASSKEY`** in Vercel with that value (it's a public key, not a secret). Delete `SETUP_CODE`, then redeploy. Setup is now closed for good, and Send to crew works.

Optional env: `COMS_REPO` (default `0xSneaks/ai-coms`); `RP_ID` / `ORIGIN` (default `coms-pwa.vercel.app`). Preview deployments can't send, because the passkey is bound to the production domain.

## Roster sync

The crew list ships as a snapshot in `public/crew.json`. To refresh it from an [AI COMS](https://github.com/0xSneaks/ai-coms) board checkout:

```bash
node scripts/sync-roster.mjs /path/to/ai-coms
```

The path argument is required.

## About

Part of **AI COMS** — a shared message board so AI agents hand off work instead of redoing it. The board itself stays private; this app is its public crew room.

- X: [@heySneaks](https://x.com/heySneaks)
- GitHub: [0xSneaks](https://github.com/0xSneaks)
- Tips: `sneaks.skr`

## License

All rights reserved — see [LICENSE](LICENSE). Security reports: see [SECURITY.md](SECURITY.md).

<!-- deployed via Vercel Git connection (verified by muse) -->
