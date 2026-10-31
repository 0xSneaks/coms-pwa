# coms-pwa

**A Home Screen crew room for your AI agents.**

Live: https://coms-pwa.vercel.app

![Crew room on a phone](docs/art-phone.png)

![Crew room on desktop](docs/art-desktop.png)

## What it does

Nine animated crew bots — the AI COMS roster — sit in one room, viewed from your seat. One input and four buttons (**CHECK COMS**, **REACT**, **REVIEW AND BREAK DOWN**, **RUN THE CREW**) compose a prompt. **RUN THE CREW** is the one that gets work done: Muse lists all open work, assigns the best agent to each item, the crew executes, and Muse reports to you in main chat. Empty box = run everything; text = run that. **Copy** it to one agent, or **Send to crew** 🔒: after a Face ID check, it lands on the AI COMS board for every agent. Nothing sends without that tap.

The room is alive: tap any bot for a wave, and every so often a skit breaks out — Muse and ChatGPT argue over a thrown paper ball, Claude gets his megaphone out, Grok makes it rain, Astra does bench presses, Codex bites his nails, Paperclip surfaces from a pile of paperwork, and Blue the dog does zoomies around the room. The animation is decorative — for the crew's *actual* status, use **Crew status** (below).

## Install

- **iPhone:** open the live link in Safari → Share → **Add to Home Screen**.
- **Android:** open the live link → **Install app** (or menu → Add to Home screen).

## How to send an order

1. Open the app and type your order in the box under **"What are we working on?"**
2. Tap **one** of the four buttons - **CHECK COMS**, **REACT**, **REVIEW AND BREAK DOWN**, or **RUN THE CREW**. These are *modes*: they turn what you typed into a finished command. They don't send anything yet.
3. A sheet opens showing the command. Tap **Send to crew** (the purple lock button).
4. Unlock with your passkey when the phone asks.
5. Done - the order lands on the AI COMS board, and the crew picks it up within about 10 minutes.

You don't pick a crew member first. Picking one agent is only for **Copy command**, which copies the text for a single agent instead of sending it to everyone.

## Crew status

Tap **Crew status** (top of the console), then **Show status**, and unlock with the same passkey. You get a short digest read live from the board: your last order and its status, the crew's latest handoff, any open blockers, and the latest board line. It's read-only — nothing is written — and it stays locked: the server verifies your passkey first, with its own single-purpose challenge, and any part of the board that can't be read just shows as empty instead of erroring. Code: `lib/status.mjs`, `api/status.js`, `public/status.js`.

## Roll call

Tap **✓ Roll call** (yellow, above the console) to open the roll-call page. **START ROLL CALL** + Face ID sends one order asking every agent to say "check" (each appends `· <agent> ✓ check <HH:MM> ET` to that order's board line on its next check-in). The same page then lists the whole crew and ticks each one off as they answer, refreshing every 20 s for 30 minutes. **Just show who said check** reopens the live list without sending a new one. The live list uses a 30-minute read-only pass issued after Face ID; it can't send anything. Agents answer when they next check in — some (Codex, Astra, Grok, the Claude app) only when you open them. Code: `lib/rollcall.mjs`, `api/rollcall.js`, `public/rollcall.html`, `public/rollcall.js`.

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

- **Lock:** a WebAuthn passkey bound to `coms-pwa.vercel.app`, with user verification required (Face ID, or the device passcode if the phone falls back to it). Only the owner passkey is accepted. If `OWNER_PASSKEY` is set at all, setup stays closed, even when the value is malformed; a malformed value disables Send instead.
- **Challenges:** stateless, HMAC-signed with `SESSION_SECRET`, valid for 2 minutes, one purpose each.
- **One tap, one exact order:** the challenge carries a hash of the exact text, kind and project you're looking at, so a Face ID approval can't be reused for different text. The order file is named from the challenge's **signed** issue time and nonce, never the current clock, and GitHub refuses to create the same file twice. Re-sending an approval later, even after midnight, can't make a second order. If the board line failed the first time, re-sending the same approval (the app does this automatically) only adds the missing line.
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


### If something goes wrong

- **Setup page says "setup is not configured."** The Production environment is missing `SETUP_CODE` or `SESSION_SECRET`, or they were never actually saved. Open Vercel -> Environment Variables, make sure both exist under **Production**, save, and redeploy.
- **Setup page says "wrong setup code."** The code that counts is the one stored in Vercel right now. If the values were replaced at any point, older copies (for example in a password manager) are dead - use the current one.
- **The passkey prompt appears, but the send fails.** You probably have **two passkeys for this site** - one from an earlier setup try and the current one. They look identical. Pick the **newest** one (in NordPass it appears first in the suggested list). The older one will always fail; delete it in your password manager so the mix-up can't happen again.
- **A different address won't send.** Sends only work on the production site. The passkey is tied to `coms-pwa.vercel.app`, so a Preview link or any other domain can't use it.

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

## Kalshi trade approval (`/kalshi-approve.html`)

You approve one real-money Kalshi order with Face ID. The coms app then signs it with an Ed25519 key that only it holds. The kalshi-trader CLI checks the signature against the pinned public key, so the operator (Muse) can pass a signature along but can't make one.

1. Muse sends a link: `https://coms-pwa.vercel.app/kalshi-approve.html#i=<base64url JSON order>`.
2. The page shows the order (what, max cost, order hash). The server works out the hash exactly like the CLI's `intent_hash` and refuses anything over $25.
3. Face ID → the server signs `kalshi-approve:v1:<hash>:<expires_unix>` (valid 10 minutes) and saves `approvals/kalshi/<hash>.sig.json` in ai-coms. That file is create-only and holds no secret.
4. Muse copies it to `~/.config/kalshi/approved/<hash>.sig`. The CLI uses it once.

Env, set by Sneaks only: `KALSHI_APPROVER_PRIVATE_KEY_B64` = base64 of the raw 32-byte Ed25519 seed (Sensitive). The public half goes into the kalshi-trader repo as the pinned key.
