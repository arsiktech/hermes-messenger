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

## Message-flicker regression

```bash
HERMES_SOURCE=/path/to/hermes-agent \
node tests/attention-stability.mjs desktop/plugin.js .test-output/attention-stability
```

This runs the actual attention classifier and plugin CSS against synthetic duplicate replies containing paragraphs, lists and line breaks. It samples classification and the following message's vertical position on 60 animation frames, excluding the first four settling frames. Calm and Results must remain folded/hidden without oscillation; All remains visible. Expansion and cleanup are also checked. The corrected implementation passes 21 checks; the pre-fix version oscillates in all six Calm/Results scenarios. No test contacts a real host.

## Command approval presentation

```bash
HERMES_SOURCE=/path/to/hermes-agent \
HERMES_ASSETS=/path/to/Hermes/dist/assets \
node tests/approval-layout.mjs desktop/plugin.js .test-output/approvals
```

60 synthetic checks cover command retention, bounds, readable action ordering, at-least-40px hit areas (current design uses 44px), keyboard traversal, overflow notices, cleanup, and absent/disabled controls. The test uses native DOM structure and real plugin CSS/reading-aid code; it neither executes displayed commands nor dispatches approval responses. The native permission menu and permanent-approval dialog remain owned by Hermes and require separate live integration acceptance.

## Bot-message attribution

```bash
HERMES_SOURCE=/path/to/hermes-agent \
node tests/agent-attribution.mjs desktop/plugin.js .test-output/agent-attribution
```

17 synthetic checks cover parenthesized/nested sender names, remote identities, literal HTML escaping, preserved body text, non-matching human prose/quotes, stable card counts, recycled DOM rows and disable cleanup. The actual thread renderer runs against a synthetic roster. No real messages or delivery records are read.

## Limits

This is a DOM-contract layout fixture, not the hydrated React clarify component or a live Hermes session. It does not prove answer submission, server authentication, screen-reader output, or the live app's floating-composer layout. Screenshots intentionally show synthetic questions rather than user data.
