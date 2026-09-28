# Browser layout regression

`clarify-layout.mjs` renders a synthetic question form matching the DOM structure in Hermes Desktop's `clarify-tool.tsx`, with the real Desktop CSS and this plugin's real CSS. It does not mock a successful backend call or submit a real answer.

## Prerequisites

- Node.js with Playwright available (either in a local Hermes source checkout or installed in this repository).
- Chrome, or another Playwright-supported installed browser channel.
- A Hermes Desktop `dist/assets` directory containing its built `index-*.css` stylesheet.

```bash
HERMES_SOURCE=/path/to/hermes-agent \
HERMES_ASSETS=/path/to/Hermes/dist/assets \
node tests/clarify-layout.mjs desktop/plugin.js .test-output/clarify
```

`HERMES_SOURCE` is optional if `playwright` is installed locally. Set `BROWSER_CHANNEL` if not using Chrome. On macOS the installed assets are normally under `/Applications/Hermes.app/Contents/Resources/app.asar.unpacked/dist/assets`.

The script writes synthetic screenshots and `results.json`, and exits nonzero on a failed assertion. No private messages, credentials, profiles, or delivery queues are read.

## Coverage

- 360px and 390px touch/mobile contexts, plus 1024px desktop; light and dark.
- Short text, a long synthetic URL, 4,096 unbroken characters, and 80 lines.
- Option rows/textarea stay inside the card; no horizontal input scrolling.
- Full value preserved; bounded input height, internal scrolling and continued editing.
- Final confirmation control reachable through page scrolling.
- Free-text-only questions, both single and batched, remain full-width.

The initial implementation failed the URL and unbroken-token cases at every width in both themes. The corrected implementation passes all 42 cases. Existing reply/quote, thread, attention, system-card and system-note checks were also rerun privately: 64 checks passed. Those older fixtures contain local conversation examples and are deliberately not published.

## Limits

This is a DOM-contract layout fixture, not the hydrated React clarify component or a live Hermes session. It does not prove answer submission, server authentication, screen-reader output, or the live app's floating-composer layout. Screenshots intentionally show synthetic questions rather than user data.
