# coms-pwa

**A Home Screen crew room for your AI agents.**

Live: https://coms-pwa.vercel.app

![Crew room on a phone](docs/art-phone.png)

![Crew room on desktop](docs/art-desktop.png)

## What it does

Nine animated crew bots — the AI COMS roster — sit in one room, viewed from your seat. One input and three buttons (**CHECK COMS**, **REACT**, **REVIEW AND BREAK DOWN**) compose a prompt you copy to your agent. Nothing auto-sends; you paste it where you want it. The animation is decorative, not live status.

## Install

- **iPhone:** open the live link in Safari → Share → **Add to Home Screen**.
- **Android:** open the live link → **Install app** (or menu → Add to Home screen).

## Run locally

Serve the `public/` folder with any static server:

```bash
npx serve public
```

Run the checks (syntax + roster tests):

```bash
npm run check
```

## Privacy

No analytics, no external requests, no accounts. What you type stays in the page — it is not stored or sent anywhere; the app only puts the composed prompt on your clipboard when you tap Copy.

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

MIT — see [LICENSE](LICENSE). Security reports: see [SECURITY.md](SECURITY.md).

<!-- deployed via Vercel Git connection (verified by muse) -->
