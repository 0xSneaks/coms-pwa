# Crew-room artwork verification

VERIFIED: Boiler Room reference `public/boiler-bot-avatar.svg` is preserved. The room extends its rounded body, visor, antenna, side vents and pressure gauge with native SVG/CSS artwork; no generated image, external font, runtime library, or paid service was added.

- Claude: orange coffee sipper; Claude Code: coral hard-hat tinkerer.
- Paperclip: lavender paper shuffler; Codex: blue magnifying-glass inspector.
- Astra: golden crowned stargazer; ChatGPT: mint plant tender.
- Muse: pink headphone dancer; Grok: peach paper-plane pilot.
- Blue: cyan sleepy nightcap. Sleep is a fictional pose, never a status claim.

VERIFIED: appearance is keyed by stable roster ID. Membership remains the roster/roll-call union. Future IDs get fallback artwork. Active/idle values never filter the room. Command composition, dialogs, safe text handling, manifest, icons and offline asset list retain their previous behavior. Service-worker cache version advances to `sneaks-coms-shell-v2-art`.

## Evidence

- [Desktop, 1440×1050](art-desktop.png)
- [Phone, 390×844](art-phone.png)
- [Narrow phone, 320×568](art-narrow-phone.png)
- [Machine-readable browser results](art-verification.json)

Screenshots capture the real browser with motion paused for inspection. Animations are separately verified running/paused; reduced motion produces zero animations, even after Resume.

VERIFIED: `npm run check` passes all three existing tests and JS syntax checks. Browser QA passes six sizes (320, 360, 390, 768, 1024 and 1440px), nonoverlapping crew hit targets, no horizontal overflow, keyboard dialogs and focus restoration, three command flows, validation, copy/fallback, installation help, local offline reload and a ten-member roster fixture. Zero page errors or HTTP 4xx/5xx responses. At 390×844 and 360×800 all command buttons fit the initial viewport; shorter screens scroll normally.

Reproduce: install Playwright in your test environment, then run `node test/art-browser.mjs` from `apps/coms-pwa`. Optional `PLAYWRIGHT_MODULE` selects its module and `CHROMIUM_PATH` an installed Chromium. This run used Chromium 153.0.8010.0 from an isolated temporary browser installation; no package/dependency changes were made to the app.

UNKNOWN: physical iPhone/Android Home Screen installation, Safari rendering and production HTTPS behavior. No production deployment or backend dispatch is claimed. Vercel integration/access remains the separate gate recorded in the technical-shell handoff.
