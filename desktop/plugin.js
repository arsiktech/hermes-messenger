/**
 * Hermes Messenger — a Telegram / iMessage-style chat for the Hermes desktop app.
 *
 *   • Bubbles: yours on the right in the accent colour, the agent's on the left.
 *   • Noise control: All · Calm · Results. "Results" hides tool calls, thinking,
 *     background-process notices and delivery receipts, and keeps only what you
 *     need to read or answer. Hold ⌥ (Alt) to peek at the hidden work.
 *   • A typing bubble while the agent works, and spring motion for new messages only.
 *   • No sticky prompt clipping the transcript.
 *
 * Pure presentation: it restyles the app's stable `data-slot` hooks and never
 * touches sessions, the backend, or message content. Disable it in
 * Capabilities → Plugins and the app is exactly as before.
 *
 * Plain ESM, loaded uncompiled. Only @hermes/plugin-sdk and react/* imports.
 */

import {
  atom,
  Codicon,
  COMPOSER_AREAS,
  haptic,
  host,
  KEYBINDS_AREA,
  PALETTE_AREA,
  readableOn,
  SegmentedControl,
  STATUSBAR_AREAS,
  Switch,
  usePluginI18n,
  useValue
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'hermes-messenger'
const ROOT = document.documentElement

const DEFAULTS = Object.freeze({ style: 'bubbles', noise: 'calm', pin: false, motion: true })
const NOISE_ORDER = ['all', 'calm', 'results']

// ─── Selectors (the app's stable data-slot contract) ────────────────────────

const USER_BUBBLE = '[data-slot="aui_user-message-root"] .composer-human-message'
const BOT_BUBBLE = '[data-slot="aui_assistant-message-content"] > .aui-md:not([data-slot="aui_reasoning-text"])'
const BUBBLES = `${USER_BUBBLE}, ${BOT_BUBBLE}`

// Anything that needs the user's hand is never hidden.
const ACTIONABLE = '[data-slot="clarify-inline"], [data-slot="tool-approval-card"], [data-slot="aui_generated-image"]'

const NOISE = [
  `[data-slot="tool-block"]:not(:has(${ACTIONABLE}))`,
  '[data-slot="aui_thinking-disclosure"]',
  '[data-slot="aui_background-result"]',
  '[data-slot="aui_background-resume"]',
  '[data-slot="aui_agent-delivery-notice"]',
  '[data-slot="aui_agent-reply-notice"]'
].join(', ')

// ─── Stylesheet ──────────────────────────────────────────────────────────────
// Every colour is a theme variable (or derived from one), so any skin works.

const CSS = /* css */ `
html[data-hm] {
  --hm-r: 1.25rem;
  --hm-tail: 0.375rem;
  --hm-in-bg: color-mix(in srgb, var(--ui-base) 10%, transparent);
  --hm-in-stroke: color-mix(in srgb, var(--ui-base) 6%, transparent);
  --hm-col: 50rem;
  --hm-spring: cubic-bezier(0.34, 1.36, 0.64, 1);
  --hm-ease: cubic-bezier(0.22, 1, 0.36, 1);
}

/* ── Bubbles: yours ───────────────────────────────────────────────────── */

html[data-hm-style='bubbles'] [data-slot='aui_user-message-root'] [data-slot='popover-anchor'] {
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  gap: 0.375rem;
}

/* Restore / stop controls move beside the bubble instead of over its text. */
html[data-hm-style='bubbles'] [data-slot='aui_user-message-root'] [data-slot='popover-anchor'] > div.absolute {
  position: static !important;
  order: -1;
  padding-bottom: 0.25rem;
}

html[data-hm-style='bubbles'] ${USER_BUBBLE} {
  width: fit-content !important;
  max-width: min(78%, 40rem) !important;
  padding: 0.5rem 0.875rem !important;
  border: 0 !important;
  border-radius: var(--hm-r) var(--hm-r) var(--hm-tail) var(--hm-r) !important;
  background: var(--hm-out-bg) !important;
  color: var(--hm-out-ink) !important;
  box-shadow: 0 0.0625rem 0.125rem rgb(0 0 0 / 0.18) !important;
  backdrop-filter: none !important;
  transform-origin: 100% 100%;
  transition: filter 0.2s var(--hm-ease), transform 0.2s var(--hm-ease);
}

html[data-hm-style='bubbles'] ${USER_BUBBLE}:hover { filter: brightness(1.06); }
html[data-hm-style='bubbles'] ${USER_BUBBLE}:active { transform: scale(0.985); }
html[data-hm-style='bubbles'] ${USER_BUBBLE} * { color: inherit; }

html[data-hm-style='bubbles'] ${USER_BUBBLE} [data-slot='aui_user-inline-code'] {
  background: color-mix(in srgb, var(--hm-out-ink) 16%, transparent) !important;
  border-color: transparent !important;
}

/* ── Your attachments: part of your message, not a stray line ─────────── */
/* The app renders a message's attached files as a row AFTER the bubble
   (a sibling of the message root), so it sat on the left as bare grey text.
   Align it under your bubble and draw each file as a card. */

html[data-hm-style='bubbles'] [data-slot='aui_user-message-root'] + div:has(> [data-slot='aui_directive-text']) {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 0.75rem;
}
html[data-hm-style='bubbles'][data-hm-pin='off'] [data-slot='aui_user-message-root'] + div:has(> [data-slot='aui_directive-text']) {
  margin-top: calc(0.25rem - var(--conversation-turn-gap, 0.75rem));
}

html[data-hm-style='bubbles'] [data-slot='aui_user-message-root'] + div > [data-slot='aui_directive-text'] {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.375rem;
  max-width: min(78%, 40rem);
  white-space: normal;
}

html[data-hm-style='bubbles'] [data-slot='aui_user-message-root'] + div [data-slot='aui_directive-chip'] {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  max-width: 100%;
  padding: 0.5rem 0.8125rem 0.5rem 0.625rem;
  border: 0.0625rem solid color-mix(in srgb, var(--hm-out-bg) 32%, transparent);
  border-radius: var(--hm-r) var(--hm-r) var(--hm-tail) var(--hm-r);
  background: color-mix(in srgb, var(--hm-out-bg) 12%, transparent);
  color: var(--ui-text-primary, var(--foreground));
  font-size: 0.8125rem;
  line-height: 1.3;
  text-align: left;
  text-decoration: none;
  overflow-wrap: anywhere;
  transition: background 0.2s var(--hm-ease), transform 0.2s var(--hm-ease);
}
html[data-hm-style='bubbles'] [data-slot='aui_user-message-root'] + div [data-slot='aui_directive-chip']:hover {
  background: color-mix(in srgb, var(--hm-out-bg) 20%, transparent);
}
html[data-hm-style='bubbles'] [data-slot='aui_user-message-root'] + div [data-slot='aui_directive-chip']:active {
  transform: scale(0.98);
}
html[data-hm-style='bubbles'] [data-slot='aui_user-message-root'] + div [data-slot='aui_directive-chip'] > svg {
  flex: none;
  width: 1.125rem;
  height: 1.125rem;
  color: var(--hm-out-bg);
}

/* Previewed files: the card replaces the path chip. */
html[data-hm] [data-hm-previewed] { display: none !important; }

html[data-hm] .hm-att {
  display: flex;
  flex-direction: column;
  align-self: flex-start;
  width: min(18rem, 100%);
  overflow: hidden;
  border: 0.0625rem solid color-mix(in srgb, var(--hm-out-bg, var(--ui-accent)) 28%, transparent);
  border-radius: var(--hm-r) var(--hm-r) var(--hm-tail) var(--hm-r);
  background: color-mix(in srgb, var(--hm-out-bg, var(--ui-accent)) 9%, var(--ui-bg, transparent));
  box-shadow: 0 0.0625rem 0.125rem rgb(0 0 0 / 0.12);
  animation: hm-pop 0.42s var(--hm-spring) both;
  white-space: normal;
}
html[data-hm] .hm-att[data-kind='image'] { width: auto; max-width: min(18rem, 100%); }
html[data-hm] .hm-att-media {
  display: block;
  width: 100%;
  max-height: 16rem;
  object-fit: cover;
  background: color-mix(in srgb, var(--ui-base, #000) 6%, transparent);
}
html[data-hm] .hm-att[data-kind='image'] .hm-att-media { width: auto; max-width: 100%; min-width: 8rem; cursor: zoom-in; object-fit: contain; }
html[data-hm] .hm-att[data-kind='audio'] .hm-att-media { height: 2.5rem; margin: 0.5rem 0.5rem 0; width: calc(100% - 1rem); background: none; }
html[data-hm] .hm-att-text {
  margin: 0;
  padding: 0.625rem 0.75rem;
  max-height: 7.5rem;
  overflow: hidden;
  font: 0.6875rem/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--ui-text-secondary, inherit);
  white-space: pre;
}
html[data-hm] .hm-att-text > div { overflow: hidden; text-overflow: ellipsis; }
html[data-hm] .hm-att-text {
  -webkit-mask-image: linear-gradient(to bottom, #000 65%, transparent);
  mask-image: linear-gradient(to bottom, #000 65%, transparent);
  border-bottom: 0.0625rem solid color-mix(in srgb, var(--ui-base, #000) 8%, transparent);
}
html[data-hm] .hm-att-foot {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  width: 100%;
  padding: 0.5rem 0.75rem 0.5625rem 0.5625rem;
  border: 0;
  background: none;
  color: var(--ui-text-primary, var(--foreground));
  text-align: left;
  cursor: pointer;
  font: inherit;
}
html[data-hm] .hm-att-foot:hover { background: color-mix(in srgb, var(--hm-out-bg, var(--ui-accent)) 8%, transparent); }
html[data-hm] .hm-att-badge {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 0.625rem;
  background: var(--hm-out-bg, var(--ui-accent));
  color: var(--hm-out-ink, #fff);
  font-size: 0.5625rem;
  font-weight: 700;
  letter-spacing: 0.02em;
}
html[data-hm] .hm-att[data-kind='image'] .hm-att-badge,
html[data-hm] .hm-att[data-kind='video'] .hm-att-badge { width: 1.75rem; height: 1.75rem; border-radius: 0.5rem; font-size: 0.5rem; }
html[data-hm] .hm-att-names { display: grid; min-width: 0; gap: 0.0625rem; }
html[data-hm] .hm-att-name {
  font-size: 0.8125rem;
  font-weight: 600;
  line-height: 1.25;
  overflow: hidden;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
/* Type colours, like a file manager: documents red, sheets green, archives amber, code slate. */
html[data-hm] .hm-att[data-ext='pdf'] .hm-att-badge { background: #e5484d; color: #fff; }
html[data-hm] .hm-att:is([data-ext='xlsx'], [data-ext='xls'], [data-ext='csv'], [data-ext='numbers']) .hm-att-badge { background: #30a46c; color: #fff; }
html[data-hm] .hm-att:is([data-ext='zip'], [data-ext='gz'], [data-ext='tar'], [data-ext='dmg'], [data-ext='7z']) .hm-att-badge { background: #f5a524; color: #1a1a1a; }
html[data-hm] .hm-att:is([data-ext='doc'], [data-ext='docx'], [data-ext='pages']) .hm-att-badge { background: #2f6fed; color: #fff; }
html[data-hm] .hm-att[data-kind='text'] .hm-att-badge { background: #5b6472; color: #fff; }
html[data-hm] .hm-att-meta { font-size: 0.6875rem; color: var(--ui-text-tertiary, #888); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Inside your bubble (a reopened chat), Telegram-style: the file sits at the
   top of the bubble on a light glass panel instead of a card of its own. */
html[data-hm] .hm-att[data-inbubble] {
  /* A fixed width (not a %): inside a fit-content bubble a % width is sized
     from the long filename's max-content and stretches the bubble. */
  width: 18rem;
  max-width: 100%;
  margin: 0.125rem 0 0.375rem;
  border: 0;
  border-radius: 0.875rem;
  background: color-mix(in srgb, var(--hm-out-ink, #fff) 14%, transparent);
  box-shadow: none;
  color: var(--hm-out-ink, #fff);
  opacity: 1;
  animation: none;
}

/* A bubble that carries a preview sizes to its content, not the full row. */
html[data-hm] .composer-human-message:has(.hm-att[data-inbubble]) { width: fit-content !important; }
html[data-hm] .hm-att[data-inbubble] .hm-att-foot { color: inherit; }
html[data-hm] .hm-att[data-inbubble] .hm-att-foot:hover { background: color-mix(in srgb, var(--hm-out-ink, #fff) 10%, transparent); }
html[data-hm] .hm-att[data-inbubble] .hm-att-meta { color: color-mix(in srgb, currentColor 72%, transparent); }
html[data-hm] .hm-att[data-inbubble] .hm-att-badge { background: color-mix(in srgb, var(--hm-out-ink, #fff) 22%, transparent); color: inherit; }
html[data-hm] .hm-att[data-inbubble] .hm-att-text { color: inherit; opacity: 0.85; border-bottom-color: color-mix(in srgb, currentColor 18%, transparent); }

html[data-hm] .hm-lightbox {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: grid;
  place-items: center;
  padding: 2rem;
  background: rgb(0 0 0 / 0.72);
  backdrop-filter: blur(0.5rem);
  cursor: zoom-out;
  animation: hm-fade 0.2s var(--hm-ease) both;
}
html[data-hm] .hm-lightbox img { max-width: 100%; max-height: 100%; border-radius: 0.75rem; box-shadow: 0 1rem 3rem rgb(0 0 0 / 0.4); }
@keyframes hm-fade { from { opacity: 0; } }

/* Image attachments: thumbnails right-aligned with the bubble's corner shape. */
html[data-hm-style='bubbles'] [data-slot='aui_user-message-root'] + div [data-slot='aui_embedded-images'] {
  justify-content: flex-end;
  margin-top: 0;
}
html[data-hm-style='bubbles'] [data-slot='aui_user-message-root'] + div :is([data-slot='aui_directive-image'], [data-slot='aui_embedded-image']) {
  border-radius: var(--hm-r) var(--hm-r) var(--hm-tail) var(--hm-r) !important;
}

/* ── Bubbles: the agent's ─────────────────────────────────────────────── */

html[data-hm-style='bubbles'] ${BOT_BUBBLE} {
  width: fit-content;
  max-width: min(88%, 48rem);
  padding: 0.5625rem 0.875rem;
  border: 0.0625rem solid var(--hm-in-stroke);
  border-radius: var(--hm-r) var(--hm-r) var(--hm-r) var(--hm-tail);
  background: var(--hm-in-bg);
  transform-origin: 0 100%;
}

/* Consecutive bubbles group tightly, Telegram-style: small inner corners. */
html[data-hm-style='bubbles'] ${BOT_BUBBLE} + .aui-md,
html[data-hm-style='bubbles'] ${BOT_BUBBLE} + [data-slot='tool-block'] + .aui-md {
  margin-top: 0.25rem !important;
  border-top-left-radius: var(--hm-tail);
}
html[data-hm-style='bubbles'] [data-slot='aui_assistant-message-content'] > [data-slot='tool-block'] {
  margin-top: 0.25rem !important;
}

/* Actions (copy, retry…) sit under the agent bubble, left-aligned like a messenger. */
html[data-hm-style='bubbles'] [data-role='assistant'] > div:has([data-slot='aui_msg-actions']) {
  align-items: flex-start !important;
}
html[data-hm-style='bubbles'] [data-role='assistant'] div:has(> [data-slot='aui_msg-actions']),
html[data-hm-style='bubbles'] [data-role='assistant'] [data-slot='aui_msg-actions'] {
  justify-content: flex-start !important;
}

/* ── Reactions, Telegram-style ───────────────────────────────────────────
   The app draws a landed reaction as a bare emoji in the action row, so it
   floats among copy/retry icons. Here it becomes a pill tucked under its
   bubble: your own reaction filled with your accent, the agent's neutral. */
html[data-hm-style='bubbles'] {
  --hm-react-own: color-mix(in srgb, var(--hm-out-bg, var(--ui-accent)) 16%, transparent);
  --hm-react-own-line: color-mix(in srgb, var(--hm-out-bg, var(--ui-accent)) 38%, transparent);
  --hm-react-other: color-mix(in srgb, var(--ui-base, #000) 6%, transparent);
  --hm-react-other-line: color-mix(in srgb, var(--ui-base, #000) 10%, transparent);
}

/* Agent messages: the reacted slot leads the footer, right under the bubble. */
html[data-hm-style='bubbles'] [data-role='assistant'] button[data-slot='aui_msg-reactions'][data-reacted] {
  order: -2;
  margin: 0.3125rem 0 0 0.25rem;
  align-self: flex-start;
}
html[data-hm-style='bubbles'] [data-role='assistant'] div:has(> button[data-slot='aui_msg-reactions'][data-reacted]) > [data-slot='aui_turn-duration'] {
  align-self: center;
  margin-top: 0.3125rem;
}
html[data-hm-style='bubbles'] button[data-slot='aui_msg-reactions'][data-reacted] {
  width: auto !important;
  height: 1.75rem !important;
  padding: 0 0.5rem !important;
  border-radius: 999px !important;
  background: var(--hm-react-own) !important;
  box-shadow: inset 0 0 0 0.0625rem var(--hm-react-own-line) !important;
  transition: transform 0.25s var(--hm-spring), background 0.2s var(--hm-ease) !important;
}
html[data-hm-style='bubbles'] button[data-slot='aui_msg-reactions'][data-reacted]:hover {
  background: color-mix(in srgb, var(--hm-out-bg, var(--ui-accent)) 24%, transparent) !important;
  transform: scale(1.06);
}
html[data-hm-style='bubbles'] button[data-slot='aui_msg-reactions'][data-reacted] > span {
  gap: 0.25rem !important;
  font-size: 1rem !important;
}

/* Your messages: each reaction its own pill, right-aligned under the bubble. */
html[data-hm-style='bubbles'] span[data-slot='aui_msg-reactions'] {
  gap: 0.25rem !important;
  padding: 0.3125rem 0.25rem 0.125rem !important;
}
html[data-hm-style='bubbles'] span[data-slot='aui_msg-reactions'] > .reaction-pop {
  display: inline-flex;
  align-items: center;
  height: 1.75rem;
  padding: 0 0.5rem;
  border-radius: 999px;
  font-size: 1rem;
  line-height: 1;
  background: var(--hm-react-other);
  box-shadow: inset 0 0 0 0.0625rem var(--hm-react-other-line);
}
html[data-hm-style='bubbles'] span[data-slot='aui_msg-reactions'] > button.reaction-pop {
  background: var(--hm-react-own);
  box-shadow: inset 0 0 0 0.0625rem var(--hm-react-own-line);
}

/* The quick picker: a floating capsule of large emoji that grow on hover. */
html[data-hm] [data-slot='popover-content']:has(> button[aria-label='More emoji']) {
  padding: 0.3125rem 0.375rem !important;
  gap: 0.125rem !important;
  border-radius: 999px !important;
  box-shadow: 0 0.5rem 1.75rem rgb(0 0 0 / 0.18), 0 0 0 0.0625rem color-mix(in srgb, var(--ui-base, #000) 8%, transparent) !important;
  animation: hm-pop 0.32s var(--hm-spring) both;
}
html[data-hm] [data-slot='popover-content']:has(> button[aria-label='More emoji']) > button {
  width: 2.25rem !important;
  height: 2.25rem !important;
  border-radius: 999px !important;
  font-size: 1.375rem !important;
  transition: transform 0.22s var(--hm-spring), background 0.15s var(--hm-ease) !important;
  animation: hm-pop 0.36s var(--hm-spring) both;
}
html[data-hm] [data-slot='popover-content']:has(> button[aria-label='More emoji']) > button:nth-child(2) { animation-delay: 0.02s; }
html[data-hm] [data-slot='popover-content']:has(> button[aria-label='More emoji']) > button:nth-child(3) { animation-delay: 0.04s; }
html[data-hm] [data-slot='popover-content']:has(> button[aria-label='More emoji']) > button:nth-child(4) { animation-delay: 0.06s; }
html[data-hm] [data-slot='popover-content']:has(> button[aria-label='More emoji']) > button:nth-child(5) { animation-delay: 0.08s; }
html[data-hm] [data-slot='popover-content']:has(> button[aria-label='More emoji']) > button:nth-child(6) { animation-delay: 0.1s; }
html[data-hm] [data-slot='popover-content']:has(> button[aria-label='More emoji']) > button:nth-child(7) { animation-delay: 0.12s; }
html[data-hm] [data-slot='popover-content']:has(> button[aria-label='More emoji']) > button:hover {
  transform: scale(1.28) translateY(-0.125rem);
  background: transparent !important;
}
html[data-hm] [data-slot='popover-content']:has(> button[aria-label='More emoji']) > button[aria-pressed='true'] {
  background: var(--hm-react-own, color-mix(in srgb, var(--ui-accent) 16%, transparent)) !important;
}
html[data-hm] [data-slot='popover-content']:has(> button[aria-label='More emoji']) > button[aria-label='More emoji'] {
  font-size: 1rem !important;
  color: var(--ui-text-tertiary, inherit);
  background: color-mix(in srgb, var(--ui-base, #000) 6%, transparent) !important;
}

/* A springier landing than the stock pop. */
html[data-hm] [data-slot='aui_msg-reactions'] .reaction-pop,
html[data-hm] span[data-slot='aui_msg-reactions'] > .reaction-pop {
  animation: hm-react-land 0.5s var(--hm-spring) both;
}
@keyframes hm-react-land {
  0% { opacity: 0; transform: scale(0.3) translateY(0.375rem); }
  55% { opacity: 1; transform: scale(1.22) translateY(-0.125rem); }
  100% { transform: none; }
}
html[data-hm][data-hm-motion='off'] [data-slot='aui_msg-reactions'] .reaction-pop,
html[data-hm][data-hm-motion='off'] [data-slot='popover-content'] > button { animation: none !important; }

/* A readable column: a conversation, not a spreadsheet. */
html[data-hm-style='bubbles'] [data-slot='aui_thread-content'] {
  max-width: var(--hm-col);
  margin-inline: auto;
}

/* The composer shares the transcript's column, so input and answers line up. */
html[data-hm-style='bubbles'] [data-slot='composer-dock'] {
  width: 100%;
  max-width: calc(var(--hm-col) + 2rem) !important;
}

/* Errors keep their colour but join the bubble shape system. */
html[data-hm-style='bubbles'] [data-slot='aui_assistant-message-content'] > div.rounded-lg[class*='dt-destructive'] {
  max-width: min(88%, 48rem);
  border-radius: var(--hm-r) var(--hm-r) var(--hm-r) var(--hm-tail);
}

/* A little more air between turns: conversations, not logs. */
html[data-hm-style='bubbles'] [data-slot='aui_message-group'] { padding-bottom: 0.625rem; }

/* ── Typing bubble ────────────────────────────────────────────────────── */

html[data-hm-style='bubbles'] :is([data-slot='aui_turn-activity'][data-state='active'], [data-slot='aui_response-loading']) {
  width: fit-content;
  min-height: 2.25rem;
  gap: 0.5rem;
  padding: 0.5rem 0.875rem;
  border: 0.0625rem solid var(--hm-in-stroke);
  border-radius: var(--hm-r) var(--hm-r) var(--hm-r) var(--hm-tail);
  background: var(--hm-in-bg);
  transform-origin: 0 100%;
  animation: hm-pop 0.42s var(--hm-spring) both;
}

html[data-hm-style='bubbles'] :is([data-slot='aui_turn-activity'][data-state='active'], [data-slot='aui_response-loading']) .dither {
  display: none;
}

html[data-hm-style='bubbles'] :is([data-slot='aui_turn-activity'][data-state='active'], [data-slot='aui_response-loading'])::before {
  --hm-dot: no-repeat radial-gradient(circle closest-side, currentColor 90%, transparent);
  content: '';
  flex: none;
  width: 1.75rem;
  aspect-ratio: 2.8;
  color: var(--ui-text-secondary);
  background: var(--hm-dot) 0% 50%, var(--hm-dot) 50% 50%, var(--hm-dot) 100% 50%;
  background-size: calc(100% / 3) 55%;
  animation: hm-dots 1.1s infinite linear;
}

/* Our own typing bubble: shown while the agent is busy but nothing else says
   so (a tool is running, or Results mode hid the work). Driven by host busy
   state, so it never lies. */
html[data-hm-style='bubbles'][data-hm-busy] [data-slot='aui_thread-content']:not(:has([data-slot='aui_turn-activity'][data-state='active'], [data-slot='aui_response-loading'], .aui-md[data-status='running']))
  > [data-slot='aui_message-group']:not(:has(~ [data-slot='aui_message-group']))::after {
  --hm-dot: no-repeat radial-gradient(circle closest-side, var(--ui-text-secondary) 90%, transparent);
  content: '';
  display: block;
  width: 3.25rem;
  height: 2.25rem;
  margin-top: 0.375rem;
  border: 0.0625rem solid var(--hm-in-stroke);
  border-radius: var(--hm-r) var(--hm-r) var(--hm-r) var(--hm-tail);
  background:
    var(--hm-dot) calc(50% - 0.5rem) 50% / 0.4375rem 0.4375rem,
    var(--hm-dot) 50% 50% / 0.4375rem 0.4375rem,
    var(--hm-dot) calc(50% + 0.5rem) 50% / 0.4375rem 0.4375rem,
    var(--hm-in-bg);
  transform-origin: 0 100%;
  animation: hm-pop 0.42s var(--hm-spring) both, hm-breathe 1.4s ease-in-out 0.42s infinite;
}

@keyframes hm-breathe {
  50% { opacity: 0.55; }
}

@keyframes hm-dots {
  20% { background-position: 0% 0%, 50% 50%, 100% 50%; }
  40% { background-position: 0% 100%, 50% 0%, 100% 50%; }
  60% { background-position: 0% 50%, 50% 100%, 100% 0%; }
  80% { background-position: 0% 50%, 50% 50%, 100% 100%; }
}

@keyframes hm-pop {
  from { transform: translateY(0.375rem) scale(0.88); opacity: 0.4; }
}

/* ── Pinned prompt (off by default: nothing clips the transcript) ─────── */

html[data-hm-pin='off'] [data-slot='aui_user-message-root'] { position: relative !important; top: auto !important; }
html[data-hm-pin='off'] [data-sticky-prompt-clip] { clip-path: none !important; }
html[data-hm-pin='off'] .sticky-human-clamp {
  max-height: none !important;
  -webkit-mask-image: none !important;
  mask-image: none !important;
}

/* ── Noise: calm (work visible, but quiet) ────────────────────────────── */

html[data-hm-noise='calm'] :is(${NOISE}) {
  opacity: 0.6;
  transition: opacity 0.25s var(--hm-ease);
}
html[data-hm-noise='calm'] :is(${NOISE}):is(:hover, :focus-within) { opacity: 1; }

/* ── Noise: results only (hold ⌥ to peek) ─────────────────────────────── */

html[data-hm-noise='results']:not([data-hm-peek]) :is(${NOISE}) { display: none !important; }
html[data-hm-noise='results']:not([data-hm-peek]) [data-slot='aui_user-message-root']:has(> [data-slot='aui_background-result']) {
  display: none !important;
}
html[data-hm-peek] :is(${NOISE}) {
  outline: 0.0625rem dashed color-mix(in srgb, var(--ui-accent) 45%, transparent);
  outline-offset: 0.1875rem;
  border-radius: 0.375rem;
}

/* ── Composer: a rounded pill like a messenger input ──────────────────── */

html[data-hm-style='bubbles'] [data-slot='composer-root'],
html[data-hm-style='bubbles'] [data-slot='composer-root'] [data-slot='composer-surface'] {
  border-radius: 1.375rem !important;
}

/* ── Settings panel ───────────────────────────────────────────────────── */

.hm-panel { display: grid; gap: 0.875rem; padding: 0.875rem; min-width: 17.5rem; }
.hm-head { display: flex; align-items: center; gap: 0.5rem; }
.hm-title { font-size: 0.8125rem; font-weight: 600; color: var(--ui-text-primary, var(--foreground)); }
.hm-row { display: grid; gap: 0.3125rem; }
.hm-row-inline { display: grid; grid-template-columns: 1fr auto; align-items: center; column-gap: 1.25rem; }
.hm-label { font-size: 0.75rem; font-weight: 500; color: var(--ui-text-primary, var(--foreground)); }
.hm-hint { font-size: 0.6875rem; line-height: 1.35; color: var(--ui-text-tertiary); }
.hm-preview { display: grid; gap: 0.3125rem; padding: 0.625rem; border-radius: 0.75rem; background: color-mix(in srgb, var(--ui-base) 4%, transparent); }
.hm-preview span {
  width: fit-content; max-width: 80%; padding: 0.3125rem 0.6875rem; font-size: 0.6875rem; line-height: 1.3;
  border-radius: 0.875rem 0.875rem 0.875rem 0.25rem; background: var(--hm-in-bg);
}
.hm-preview span.hm-out {
  justify-self: end; border-radius: 0.875rem 0.875rem 0.25rem 0.875rem;
  background: var(--hm-out-bg); color: var(--hm-out-ink);
}
.hm-preview[data-style='classic'] span { border-radius: 0.25rem; background: transparent; padding-inline: 0; }
.hm-preview[data-style='classic'] span.hm-out { background: var(--hm-in-bg); color: inherit; padding-inline: 0.6875rem; }
.hm-preview[data-noise='results'] .hm-tool { display: none; }
.hm-preview .hm-tool { font-size: 0.625rem; color: var(--ui-text-tertiary); padding: 0 0.25rem; transition: opacity 0.2s var(--hm-ease); }
.hm-preview[data-noise='calm'] .hm-tool { opacity: 0.6; }
.hm-chip { display: inline-flex; align-items: center; gap: 0.3125rem; }
.hm-chip-dot { width: 0.375rem; height: 0.375rem; border-radius: 999px; background: var(--ui-accent); transition: transform 0.3s var(--hm-spring); }
.hm-chip-dot[data-level='all'] { transform: scale(0.5); opacity: 0.5; }
.hm-chip-dot[data-level='calm'] { transform: scale(0.8); }
.hm-chip-dot[data-level='results'] { transform: scale(1.15); }

/* ── Questions (clarify): an agent bubble with quick-reply chips ─────── */

html[data-hm-style='bubbles'] form:has(> [data-slot='clarify-inline']) {
  width: min(100%, 36rem);
  justify-items: stretch;
  gap: 0.5rem;
}
html[data-hm-style='bubbles'] [data-slot='clarify-inline'] {
  max-width: min(100%, 36rem);
  padding: 0.75rem 0.875rem 0.875rem;
  border: 0.0625rem solid var(--hm-in-stroke);
  border-radius: var(--hm-r) var(--hm-r) var(--hm-r) var(--hm-tail);
  background: var(--hm-in-bg);
  font-size: inherit;
  transform-origin: 0 100%;
  animation: hm-pop 0.42s var(--hm-spring) both;
}
html[data-hm-style='bubbles'] [data-slot='clarify-inline'][data-clarify-settled] { width: fit-content; }
/* The question reads like message text, not a form heading. */
html[data-hm-style='bubbles'] [data-slot='clarify-inline'] .font-medium { font-weight: 500; }
/* The "?" icon and a lone "0 of 1 answered" say nothing a bubble doesn't. */
html[data-hm-style='bubbles'] [data-slot='clarify-inline'] > div:first-child > svg:last-child { display: none; }
html[data-hm-style='bubbles'] form[data-clarify-batch='1'] > [data-slot='clarify-inline'] > div:first-child:has(> span.text-\\[0\\.6875rem\\]) { display: none; }

/* Options become rounded reply chips. */
html[data-hm-style='bubbles'] [data-slot='clarify-inline'] [role='group'] { gap: 0.375rem; margin-top: 0.25rem; }
html[data-hm-style='bubbles'] [data-slot='clarify-inline'] [role='group'] > :is(button, label),
html[data-hm-style='bubbles'] [data-slot='clarify-inline'] [role='group'] > span > button {
  align-items: center;
  gap: 0.625rem;
  box-sizing: border-box;
  min-height: 2.5rem;
  padding: 0.4375rem 0.75rem 0.4375rem 0.5rem;
  border: 0.0625rem solid color-mix(in srgb, var(--hm-out-bg, var(--ui-accent)) 22%, transparent);
  border-radius: 0.875rem;
  background: color-mix(in srgb, var(--ui-bg-primary, #fff) 72%, transparent);
  color: var(--ui-text-primary);
  transition: border-color 0.15s var(--hm-ease), background-color 0.15s var(--hm-ease), transform 0.15s var(--hm-ease);
}
html[data-hm-style='bubbles'] [data-slot='clarify-inline'] [role='group'] :is(button, label):is(:hover, [data-highlighted]):not([aria-pressed='true']) {
  border-color: color-mix(in srgb, var(--hm-out-bg, var(--ui-accent)) 40%, transparent);
  background: var(--ui-bg-primary, #fff);
}
html[data-hm-style='bubbles'] [data-slot='clarify-inline'] [role='group'] button:active:not(:disabled) { transform: scale(0.985); }
html[data-hm-style='bubbles'] [data-slot='clarify-inline'] [role='group'] button[aria-pressed='true'] {
  border-color: var(--hm-out-bg, var(--ui-accent));
  background: color-mix(in srgb, var(--hm-out-bg, var(--ui-accent)) 12%, var(--ui-bg-primary, #fff));
}
/* Letter keys: small round tokens; selected = your bubble colour. */
html[data-hm-style='bubbles'] [data-slot='clarify-inline'] [role='group'] [data-slot='kbd'] {
  width: 1.5rem; min-width: 1.5rem; height: 1.5rem;
  margin-top: 0;
  border-radius: 999px;
  border-color: color-mix(in srgb, var(--hm-out-bg, var(--ui-accent)) 30%, transparent);
  background: transparent;
  color: var(--hm-out-bg, var(--ui-accent));
  font-weight: 600;
  box-shadow: none;
}
html[data-hm-style='bubbles'] [data-slot='clarify-inline'] [role='group'] :is(button[aria-pressed='true'], label:has(textarea:not(:placeholder-shown))) [data-slot='kbd'] {
  border-color: var(--hm-out-bg, var(--ui-accent));
  background: var(--hm-out-bg, var(--ui-accent));
  color: var(--hm-out-ink, #fff);
}
/* "(Recommended)" becomes a small tag. */
html[data-hm-style='bubbles'] [data-slot='clarify-inline'] [role='group'] button .flex-1 > span {
  display: inline-block;
  margin-left: 0.25rem;
  padding: 0.0625rem 0.4375rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--hm-out-bg, var(--ui-accent)) 12%, transparent);
  color: var(--hm-out-bg, var(--ui-accent));
  font-size: 0.6875rem;
  font-weight: 600;
  vertical-align: 0.0625rem;
}
/* "Other": the chip is the field; no box inside a box. */
html[data-hm-style='bubbles'] [data-slot='clarify-inline'] [data-slot='textarea'] {
  box-sizing: border-box;
  width: auto;
  min-width: 0;
  min-height: 1.5rem;
  margin: 0;
  padding: 0.125rem 0;
  line-height: 1.25rem;
  font-size: inherit;
  align-self: center;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  outline: none;
}
html[data-hm-style='bubbles'] [data-slot='clarify-inline'] > [data-slot='textarea'] {
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: 0.0625rem solid color-mix(in srgb, var(--hm-out-bg, var(--ui-accent)) 22%, transparent);
  border-radius: 0.875rem;
  background: color-mix(in srgb, var(--ui-bg-primary, #fff) 72%, transparent);
}

/* Actions sit under the bubble on its side, as capsules in your colour. */
html[data-hm-style='bubbles'] form:has(> [data-slot='clarify-inline']) > div:last-child { justify-content: flex-start; gap: 0.375rem; }
html[data-hm-style='bubbles'] form:has(> [data-slot='clarify-inline']) > div:last-child > [data-slot='button'] {
  height: 2rem;
  padding: 0 0.875rem;
  border-radius: 999px;
  font-size: 0.8125rem;
}
html[data-hm-style='bubbles'] form:has(> [data-slot='clarify-inline']) > div:last-child > [data-slot='button'][type='submit'] {
  order: -1;
  background: var(--hm-out-bg, var(--ui-accent));
  color: var(--hm-out-ink, #fff);
  box-shadow: 0 0.0625rem 0.125rem rgb(0 0 0 / 0.15);
}
html[data-hm-style='bubbles'] form:has(> [data-slot='clarify-inline']) > div:last-child > [data-slot='button'][type='submit']:disabled { opacity: 0.4; }
html[data-hm-style='bubbles'] form:has(> [data-slot='clarify-inline']) > div:last-child > [data-slot='button']:not([type='submit']) { color: var(--ui-text-secondary); }
html[data-hm-motion='off'] [data-slot='clarify-inline'] { animation: none !important; }

/* ── Replies & quotes ─────────────────────────────────────────────────── */

.hm-reply-btn {
  position: fixed; z-index: 60; display: grid; place-items: center;
  width: 1.75rem; height: 1.75rem; padding: 0; border: 0.0625rem solid var(--hm-in-stroke, rgb(0 0 0 / 0.08));
  border-radius: 999px; background: var(--ui-bg-primary, #fff); color: var(--ui-text-secondary, #666);
  box-shadow: 0 0.125rem 0.5rem rgb(0 0 0 / 0.12); cursor: pointer;
  opacity: 0; pointer-events: none; transform: scale(0.85);
  transition: opacity 0.12s ease, transform 0.18s var(--hm-spring, ease);
}
.hm-reply-btn[data-show] { opacity: 1; pointer-events: auto; transform: none; }
.hm-reply-btn:hover { color: var(--hm-out-bg, var(--ui-accent)); }
.hm-quote-pill {
  position: fixed; z-index: 61; display: inline-flex; align-items: center; gap: 0.375rem;
  height: 2rem; padding: 0 0.75rem; border: 0; border-radius: 999px;
  background: var(--hm-out-bg, var(--ui-accent)); color: var(--hm-out-ink, #fff);
  font: 500 0.8125rem/1 inherit; box-shadow: 0 0.25rem 0.875rem rgb(0 0 0 / 0.2); cursor: pointer;
  opacity: 0; pointer-events: none; transform: translate(-50%, -100%) scale(0.9);
  transition: opacity 0.12s ease, transform 0.18s var(--hm-spring, ease);
}
.hm-quote-pill[data-below] { transform: translate(-50%, 0) scale(0.9); }
.hm-quote-pill:not([data-show]) { transition-duration: 0s; }
.hm-quote-pill[data-show] { opacity: 1; pointer-events: auto; transform: translate(-50%, -100%); }
.hm-quote-pill[data-below][data-show] { transform: translate(-50%, 0); }

/* The bar above the input: accent rule, who, one-line excerpt, ✕. */
.hm-replybar {
  display: flex; align-items: center; gap: 0.625rem; margin: 0.25rem 0.5rem 0.125rem;
  padding: 0.375rem 0.25rem 0.375rem 0.625rem;
  border-left: 0.1875rem solid var(--hm-out-bg, var(--ui-accent));
  border-radius: 0.375rem; background: color-mix(in srgb, var(--hm-out-bg, var(--ui-accent)) 7%, transparent);
  animation: hm-fade 0.18s ease both;
}
.hm-replybar-icon { display: grid; color: var(--hm-out-bg, var(--ui-accent)); }
.hm-replybar-body { flex: 1; min-width: 0; }
.hm-replybar-who { font-size: 0.75rem; font-weight: 600; line-height: 1.1rem; color: var(--hm-out-bg, var(--ui-accent)); }
.hm-replybar-text { overflow: hidden; font-size: 0.8125rem; line-height: 1.2rem; white-space: nowrap; text-overflow: ellipsis; color: var(--ui-text-secondary); }
.hm-replybar-x {
  display: grid; place-items: center; width: 1.75rem; height: 1.75rem; border: 0; border-radius: 999px;
  background: transparent; color: var(--ui-text-tertiary); cursor: pointer;
}
.hm-replybar-x:hover { background: color-mix(in srgb, var(--ui-base) 8%, transparent); color: var(--ui-text-primary); }

/* A sent reply: Telegram-style quote card at the top of your bubble. */
.hm-quote {
  display: block; margin: 0 0 0.375rem; padding: 0.25rem 0.5rem 0.3125rem 0.5625rem;
  border-left: 0.1875rem solid currentColor; border-radius: 0.375rem;
  background: color-mix(in srgb, currentColor 12%, transparent);
  font-size: 0.8125rem; line-height: 1.25rem; cursor: pointer; text-align: left;
}
.hm-quote:hover { background: color-mix(in srgb, currentColor 18%, transparent); }
.hm-quote:focus-visible { outline: 0.125rem solid currentColor; outline-offset: 0.125rem; }
.hm-quote-who { display: block; font-weight: 600; font-size: 0.75rem; }
.hm-quote-text {
  display: -webkit-box; overflow: hidden; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
  white-space: normal; opacity: 0.95;
}
[data-hm-hidden] { display: none !important; }
:is(${BUBBLES})[data-hm-flash] { animation: hm-flash 1.4s ease both; }
@keyframes hm-flash {
  0%, 35% { box-shadow: 0 0 0 0.25rem color-mix(in srgb, var(--hm-out-bg, var(--ui-accent)) 45%, transparent); }
  100% { box-shadow: 0 0 0 0.25rem transparent; }
}

/* ── Command approvals: same bubble, same capsules as questions ──────── */

html[data-hm-style='bubbles'] [data-slot='tool-approval-stack'] { max-width: min(100%, 36rem); align-self: flex-start; }
html[data-hm-style='bubbles'] [data-slot='tool-approval-stack'] :is([data-slot='card-stack-surface'], [data-slot='card-stack-edge']) {
  border: 0.0625rem solid var(--hm-in-stroke);
  border-radius: var(--hm-r) var(--hm-r) var(--hm-r) var(--hm-tail);
  background: var(--hm-in-bg);
}
/* Floating over the transcript it must be opaque: same grey, laid on the page colour. */
html[data-hm-style='bubbles'] [data-slot='tool-approval-stack'][data-approval-placement='floating'] [data-slot='card-stack-surface'] {
  background: linear-gradient(var(--hm-in-bg), var(--hm-in-bg)), var(--ui-bg-primary, #fff);
  box-shadow: 0 0.5rem 1.5rem rgb(0 0 0 / 0.12);
}
html[data-hm-style='bubbles'] [data-slot='tool-approval-card'] { animation: hm-pop 0.42s var(--hm-spring) both; transform-origin: 0 100%; }
/* Header: "Command" reads as the question, the way a question card does. */
html[data-hm-style='bubbles'] [data-slot='tool-approval-card'] > div:first-child {
  padding: 0.75rem 0.875rem 0;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--ui-text-primary);
}
/* The command: a shaded code block with a visible scroll edge. */
html[data-hm-style='bubbles'] [data-slot='tool-approval-card'] > pre {
  margin: 0.5rem 0.875rem 0 !important;
  max-height: 14rem;
  padding: 0.625rem 0.75rem;
  border: 0.0625rem solid var(--hm-in-stroke);
  border-radius: 0.75rem;
  background: color-mix(in srgb, var(--ui-base) 5%, transparent);
  font-size: 0.75rem;
  line-height: 1.55;
  word-break: normal;
  overflow-wrap: break-word;
  scrollbar-width: thin;
}
/* Actions: Run first in your colour, the rest as quiet capsules. */
html[data-hm-style='bubbles'] [data-slot='tool-approval-actions'] {
  justify-content: flex-start;
  gap: 0.375rem;
  padding: 0.625rem 0.875rem 0.75rem;
}
html[data-hm-style='bubbles'] [data-slot='tool-approval-actions'] [data-slot='button'] {
  height: 2rem;
  padding: 0 0.875rem;
  border-radius: 999px;
  font-size: 0.8125rem;
}
html[data-hm-style='bubbles'] [data-slot='tool-approval-actions'] [data-approval-run] {
  order: -2;
  background: var(--hm-out-bg, var(--ui-accent));
  color: var(--hm-out-ink, #fff);
  box-shadow: 0 0.0625rem 0.125rem rgb(0 0 0 / 0.15);
}
html[data-hm-style='bubbles'] [data-slot='tool-approval-actions'] > :not([data-approval-run], [data-approval-deny]) { order: -1; }
html[data-hm-style='bubbles'] [data-slot='tool-approval-actions'] [data-slot='button']:not([data-approval-run], [data-approval-deny]) {
  border: 0.0625rem solid color-mix(in srgb, var(--hm-out-bg, var(--ui-accent)) 22%, transparent);
  background: var(--ui-bg-primary, #fff);
  color: var(--ui-text-primary);
}
/* Reject: plain text like Skip on questions, pushed right; turns red on hover. */
html[data-hm-style='bubbles'] [data-slot='tool-approval-actions'] [data-approval-deny] { margin-left: auto; background: transparent; color: var(--ui-text-secondary) !important; }
html[data-hm-style='bubbles'] [data-slot='tool-approval-actions'] [data-approval-deny]:hover { color: var(--destructive, #d33) !important; background: color-mix(in srgb, var(--destructive, #d33) 8%, transparent); }
/* Waiting on you, not typing: hide the typing bubble while an approval is open. */
html[data-hm-style='bubbles']:has([data-slot='tool-approval-card']:not([aria-hidden])) :is([data-slot='aui_turn-activity'][data-state='active'], [data-slot='aui_response-loading']) { display: none; }
html[data-hm-motion='off'] [data-slot='tool-approval-card'] { animation: none !important; }

@media (prefers-reduced-motion: reduce) {
  html[data-hm] *, html[data-hm] *::before { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; }
}
html[data-hm-motion='off'] :is(${BUBBLES}, .hm-att, [data-slot='aui_turn-activity'], [data-slot='aui_response-loading']) {
  animation: none !important;
  transition: none !important;
}
`

// ─── Locale ─────────────────────────────────────────────────────────────────

const LOCALES = {
  en: {
    name: 'Messenger',
    title: 'Messenger',
    style: 'Chat style',
    styleHint: 'Bubbles like Telegram or iMessage, or the classic transcript.',
    bubbles: 'Bubbles',
    classic: 'Classic',
    noise: 'Show',
    noiseHint: {
      all: 'Everything: every tool call, thought and notice.',
      calm: 'Work stays visible but faded. Hover to read it.',
      results: 'Only answers and things that need you. Hold ⌥ to peek.'
    },
    all: 'All',
    calm: 'Calm',
    results: 'Results',
    pin: 'Pin my last message',
    pinHint: 'Keeps your prompt stuck to the top while you scroll.',
    motion: 'Motion',
    motionHint: 'Spring animations for new messages.',
    previewIn: 'Done. Deployed and verified ✓',
    previewOut: 'Ship it 🚀',
    chipTip: 'Messenger: chat style & noise',
    cycle: 'Messenger: cycle noise (All → Calm → Results)',
    toggleStyle: 'Messenger: toggle bubbles',
    toast: level => `Showing: ${level}`,
    reply: 'Reply',
    quote: 'Quote',
    you: 'You',
    agent: 'Agent',
    replyingTo: who => `Replying to ${who}`,
    quotingFrom: who => `Quoting ${who}`,
    cancelReply: 'Cancel reply'
  },
  ru: {
    name: 'Мессенджер',
    title: 'Мессенджер',
    style: 'Стиль чата',
    styleHint: 'Пузыри как в Telegram или iMessage, или классическая лента.',
    bubbles: 'Пузыри',
    classic: 'Классика',
    noise: 'Показывать',
    noiseHint: {
      all: 'Всё: каждый вызов инструмента, мысль и уведомление.',
      calm: 'Работа видна, но приглушена. Наведите, чтобы прочитать.',
      results: 'Только ответы и то, что требует вас. Удерживайте ⌥, чтобы подсмотреть.'
    },
    all: 'Всё',
    calm: 'Тихо',
    results: 'Итоги',
    pin: 'Закреплять моё сообщение',
    pinHint: 'Ваш запрос прилипает к верху при прокрутке.',
    motion: 'Анимация',
    motionHint: 'Пружинная анимация новых сообщений.',
    previewIn: 'Готово. Развёрнуто и проверено ✓',
    previewOut: 'Запускай 🚀',
    chipTip: 'Мессенджер: стиль и шум',
    cycle: 'Мессенджер: уровень шума (Всё → Тихо → Итоги)',
    toggleStyle: 'Мессенджер: включить/выключить пузыри',
    toast: level => `Показываю: ${level}`,
    reply: 'Ответить',
    quote: 'Цитировать',
    you: 'Вы',
    agent: 'Агент',
    replyingTo: who => `Ответ: ${who}`,
    quotingFrom: who => `Цитата: ${who}`,
    cancelReply: 'Отменить ответ'
  }
}

// ─── State ──────────────────────────────────────────────────────────────────

let $settings = atom({ ...DEFAULTS })
let save = () => {}
const $reply = atom(null)

function update(patch) {
  const next = { ...$settings.get(), ...patch }
  $settings.set(next)
  save(next)
}

function cycleNoise() {
  const cur = $settings.get().noise
  const next = NOISE_ORDER[(NOISE_ORDER.indexOf(cur) + 1) % NOISE_ORDER.length]
  update({ noise: next })
  return next
}

function applyAttributes(s) {
  ROOT.setAttribute('data-hm', '')
  ROOT.setAttribute('data-hm-style', s.style)
  ROOT.setAttribute('data-hm-noise', s.noise)
  ROOT.setAttribute('data-hm-pin', s.pin ? 'on' : 'off')
  ROOT.setAttribute('data-hm-motion', s.motion ? 'on' : 'off')
}

function clearAttributes() {
  for (const name of ['data-hm', 'data-hm-style', 'data-hm-noise', 'data-hm-pin', 'data-hm-motion', 'data-hm-peek', 'data-hm-busy']) {
    ROOT.removeAttribute(name)
  }
}

// ─── Accent ink: readable text on the accent bubble, for any theme ──────────

function resolveAccentHex() {
  const probe = document.createElement('span')
  probe.style.cssText = 'position:absolute;visibility:hidden;color:var(--ui-accent)'
  document.body.append(probe)
  const raw = getComputedStyle(probe).color
  probe.remove()
  const nums = (raw.match(/-?[\d.]+/g) || []).map(Number)

  if (nums.length < 3) {
    return null
  }

  const scale = raw.startsWith('color(') ? 255 : 1
  const hex = nums
    .slice(0, 3)
    .map(n => Math.max(0, Math.min(255, Math.round(n * scale))).toString(16).padStart(2, '0'))
    .join('')

  return `#${hex}`
}

// Messenger bubbles carry white text. Keep the theme's accent hue, and deepen
// it just enough to reach WCAG AA (4.5:1) against white. Pale accents that
// would turn muddy fall back to the theme's own readable ink instead.
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  const lin = c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

const contrastWithWhite = hex => 1.05 / (luminance(hex) + 0.05)

function shade(hex, keep) {
  return `#${[1, 3, 5]
    .map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * keep).toString(16).padStart(2, '0'))
    .join('')}`
}

function bubbleVars(hex) {
  if (!hex) {
    return 'html[data-hm]{--hm-out-bg:var(--ui-accent);--hm-out-ink:var(--foreground)}'
  }

  let bg = hex
  let keep = 1

  while (contrastWithWhite(bg) < 4.5 && keep > 0.55) {
    keep -= 0.03
    bg = shade(hex, keep)
  }

  if (contrastWithWhite(bg) >= 4.5) {
    return `html[data-hm]{--hm-out-bg:${bg};--hm-out-ink:#fff}`
  }

  return `html[data-hm]{--hm-out-bg:${hex};--hm-out-ink:${readableOn(hex)}}`
}

// ─── Motion: animate genuinely NEW bubbles only ─────────────────────────────

function createMotion(ctx) {
  const seen = new Set()
  let settleUntil = performance.now() + 1500
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')

  const keyOf = el => {
    const root = el.closest('[data-message-id]')
    const id = root?.getAttribute('data-message-id')

    if (!id) {
      return null
    }

    if (el.matches(USER_BUBBLE)) {
      return `${id}:u`
    }

    const parts = [...el.parentElement.querySelectorAll(':scope > .aui-md')]

    return `${id}:a${parts.indexOf(el)}`
  }

  const play = el => {
    const s = $settings.get()

    if (!s.motion || s.style !== 'bubbles' || reduced.matches) {
      return
    }

    const out = el.matches(USER_BUBBLE)
    // Transform-only with a backwards fill: if Chromium pauses the timeline
    // (hidden window), the bubble is merely offset, never invisible.
    el.animate(
      out
        ? [
            { transform: 'translate(0.5rem, 1.25rem) scale(0.82)' },
            { transform: 'translate(0, -0.125rem) scale(1.015)', offset: 0.7 },
            { transform: 'none' }
          ]
        : [
            { transform: 'translate(-0.25rem, 0.625rem) scale(0.9)' },
            { transform: 'translateY(-0.0625rem) scale(1.01)', offset: 0.7 },
            { transform: 'none' }
          ],
      { duration: out ? 460 : 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' }
    )
  }

  const collect = (node, into) => {
    if (node.nodeType !== 1) {
      return
    }

    if (node.matches(BUBBLES)) {
      into.push(node)
    } else if (node.firstElementChild) {
      into.push(...node.querySelectorAll(BUBBLES))
    }
  }

  const observer = new MutationObserver(records => {
    const found = []

    for (const record of records) {
      for (const node of record.addedNodes) {
        collect(node, found)
      }
    }

    if (!found.length) {
      return
    }

    // A session switch or history load lands many bubbles at once: that is
    // the past arriving, not a message. Record it silently.
    const quiet = performance.now() < settleUntil || found.length > 3

    for (const el of found) {
      const key = keyOf(el)

      if (!key || seen.has(key)) {
        continue
      }

      seen.add(key)

      if (!quiet) {
        play(el)
      }
    }
  })

  for (const el of document.querySelectorAll(BUBBLES)) {
    const key = keyOf(el)

    if (key) {
      seen.add(key)
    }
  }

  observer.observe(document.body, { childList: true, subtree: true })
  ctx.onDispose(() => observer.disconnect())

  const settle = () => {
    settleUntil = performance.now() + 1200
  }

  for (const $a of [host.state.focusedSessionId, host.state.activeSessionId]) {
    if ($a?.listen) {
      ctx.onDispose($a.listen(settle))
    }
  }
}

// ─── Attachment previews (SDK-free: also loaded by the visual test fixture) ─
// The app shows an attached file as a path chip. Like Telegram/ChatGPT, turn it
// into the file itself: image thumbnail, playable video/audio, the first lines
// of a text/code file, or a type card with size. The original chip stays in the
// DOM (hidden) so the app keeps owning it; if a file can't be read (remote
// gateway, moved, too big) the chip simply stays visible.

// Fresh send: the app renders attachments in a row AFTER the bubble. Reopened
// chat: the same `@file:` stays inline in the message text, INSIDE the bubble.
const ATTACH_CHIP = [
  "[data-slot='aui_user-message-root'] + div [data-slot='aui_directive-chip'][data-ref='file']",
  "[data-slot='aui_user-message-root'] .composer-human-message [data-slot='aui_directive-chip'][data-ref='file']"
].join(', ')
const KINDS = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'heic'],
  video: ['mp4', 'mov', 'm4v', 'webm'],
  audio: ['mp3', 'm4a', 'wav', 'ogg', 'aac', 'flac', 'opus'],
  text: ['txt', 'md', 'json', 'yaml', 'yml', 'toml', 'csv', 'log', 'py', 'js', 'mjs', 'ts', 'tsx', 'jsx', 'swift',
    'cs', 'go', 'rs', 'java', 'kt', 'rb', 'sh', 'zsh', 'sql', 'html', 'css', 'xml', 'ini', 'env', 'c', 'h', 'cpp']
}
const kindOf = ext => Object.keys(KINDS).find(k => KINDS[k].includes(ext)) || 'file'

function formatBytes(n) {
  if (!(n >= 0)) return ''
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`
}

async function thumbnailOf(dataUrl, maxPx = 640) {
  try {
    const img = new Image()
    img.src = dataUrl
    await img.decode()
    const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight))
    if (scale === 1) return { src: dataUrl, w: img.naturalWidth, h: img.naturalHeight }
    const c = document.createElement('canvas')
    c.width = Math.round(img.naturalWidth * scale)
    c.height = Math.round(img.naturalHeight * scale)
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    return { src: c.toDataURL('image/jpeg', 0.86), w: img.naturalWidth, h: img.naturalHeight }
  } catch {
    return { src: dataUrl, w: 0, h: 0 }
  }
}

function openLightbox(src, alt) {
  const box = document.createElement('div')
  box.className = 'hm-lightbox'
  const img = document.createElement('img')
  img.src = src
  img.alt = alt
  box.append(img)
  const close = () => { box.remove(); window.removeEventListener('keydown', onKey, true) }
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close() } }
  box.addEventListener('click', close)
  window.addEventListener('keydown', onKey, true)
  document.body.append(box)
}

function createAttachmentPreviews({ bridge, cwd, onDispose }) {
  const cache = new Map()

  const candidates = id => {
    if (id.startsWith('/')) return [id]
    const base = (cwd() || '').replace(/\/+$/, '')
    const home = (base.match(/^\/(?:Users|home)\/[^/]+/) || [])[0]
    const rel = id.replace(/^~\//, '')
    return [...new Set([id.startsWith('~/') ? null : base && `${base}/${rel}`, home && `${home}/${rel}`].filter(Boolean))]
  }

  const load = async id => {
    const name = id.split('/').pop() || id
    const ext = (name.includes('.') ? name.split('.').pop() : '').toLowerCase()
    const kind = kindOf(ext)
    for (const path of candidates(id)) {
      try {
        const info = await bridge.readFileText(path)
        const out = { path: info?.path || path, name, ext, kind, size: info?.byteSize }
        if (kind === 'image') out.full = await bridge.readFileDataUrl(out.path)
        if (kind === 'text' && info && !info.binary) out.lines = String(info.text || '').split('\n').slice(0, 7).join('\n')
        return out
      } catch (e) {
        // EFBIG still means the file exists; media can stream without a size cap.
        if (/EFBIG|too large/i.test(String(e?.message || e)) && (kind === 'video' || kind === 'audio')) {
          return { path, name, ext, kind }
        }
      }
    }
    return null
  }

  const build = async (chip, f) => {
    const card = document.createElement('div')
    card.className = 'hm-att'
    card.dataset.kind = f.kind
    card.title = f.path

    const folder = f.path.split('/').slice(-2, -1)[0] || ''
    const meta = [f.ext.toUpperCase(), formatBytes(f.size), folder].filter(Boolean).join(' · ')

    if (f.kind === 'image' && f.full) {
      const t = await thumbnailOf(f.full)
      const img = document.createElement('img')
      img.className = 'hm-att-media'
      img.src = t.src
      img.alt = f.name
      img.draggable = false
      if (t.w && t.h) img.style.aspectRatio = `${t.w} / ${t.h}`
      img.addEventListener('click', () => openLightbox(f.full, f.name))
      card.append(img)
    } else if (f.kind === 'video' || f.kind === 'audio') {
      const m = document.createElement(f.kind)
      m.className = 'hm-att-media'
      m.controls = true
      m.preload = 'metadata'
      m.src = `hermes-media://stream/${encodeURIComponent(f.path)}${f.kind === 'video' ? '#t=0.1' : ''}`
      card.append(m)
    } else if (f.kind === 'text' && f.lines) {
      const pre = document.createElement('div')
      pre.className = 'hm-att-text'
      for (const line of f.lines.split('\n').filter((l, i, a) => l.trim() || (i > 0 && a[i - 1].trim())).slice(0, 6)) {
        const row = document.createElement('div')
        row.textContent = line || ' '
        pre.append(row)
      }
      card.append(pre)
    }
    card.dataset.ext = f.ext

    const foot = document.createElement('button')
    foot.type = 'button'
    foot.className = 'hm-att-foot'
    foot.title = 'Show in Finder'
    foot.innerHTML = '<span class="hm-att-badge"></span><span class="hm-att-names"><span class="hm-att-name"></span><span class="hm-att-meta"></span></span>'
    foot.querySelector('.hm-att-badge').textContent = (f.ext || '•').slice(0, 4).toUpperCase()
    foot.querySelector('.hm-att-name').textContent = f.name
    foot.querySelector('.hm-att-meta').textContent = meta
    foot.addEventListener('click', () => bridge.revealPath?.(f.path))
    card.append(foot)

    if (chip.closest('.composer-human-message')) card.setAttribute('data-inbubble', '')
    chip.after(card)
    chip.setAttribute('data-hm-previewed', '')
  }

  const scan = () => {
    for (const chip of document.querySelectorAll(`:is(${ATTACH_CHIP}):not([data-hm-previewed]):not([data-hm-pending])`)) {
      const id = chip.getAttribute('data-directive-id') || chip.getAttribute('title') || ''
      if (!id) continue
      chip.setAttribute('data-hm-pending', '')
      if (!cache.has(id)) cache.set(id, load(id))
      cache.get(id)
        .then(f => (f && chip.isConnected ? build(chip, f) : null))
        .catch(() => {})
        .finally(() => chip.removeAttribute('data-hm-pending'))
    }
  }

  let frame = 0
  const observer = new MutationObserver(() => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(scan)
  })
  observer.observe(document.body, { childList: true, subtree: true })
  scan()
  onDispose(() => {
    observer.disconnect()
    cancelAnimationFrame(frame)
    for (const el of document.querySelectorAll('.hm-att, .hm-lightbox')) el.remove()
    for (const el of document.querySelectorAll('[data-hm-previewed]')) el.removeAttribute('data-hm-previewed')
  })
}
// ─── end attachment previews ────────────────────────────────────────────────

// ─── Replies & quotes (SDK-free: also loaded by the visual test fixture) ────
// Messenger-style replies: hover a bubble and click ↩, or select text inside it
// and click "Quote". The reply rides on the message itself, in the same
// `[Replying to …: "…"]` form the gateway uses for Telegram replies, so the
// agent reads it exactly like a Telegram reply. The transcript renders it back
// as a quote card above your text; clicking the card jumps to the original.

const REPLY_RE = /^\s*\[Replying to (your|my) message: "([\s\S]*?)"\]\n\n/
const QUOTE_MAX = 1200
const EXCERPT_MAX = 280
const REPLY_SVG = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 3.5 2.5 7.5l4 4"/><path d="M2.5 7.5h6.5a4.5 4.5 0 0 1 4.5 4.5v.5"/></svg>'

function replyWire({ whose, text }) {
  const clean = String(text).replace(/\r/g, '').replace(/\n{2,}/g, '\n').trim()
  return `[Replying to ${whose} message: "${clean}"]\n\n`
}

function bubbleText(bubble) {
  const clone = bubble.cloneNode(true)
  for (const el of clone.querySelectorAll('.hm-quote, .hm-att, button, [data-hm-hidden]')) el.remove()
  return clone.textContent.replace(/\s+/g, ' ').trim()
}

const clipText = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)
const elementOf = node => (node && node.nodeType === 1 ? node : node?.parentElement) || null

function createReplies({ setReply, label, onDispose }) {
  const whoseOf = bubble => (bubble.closest("[data-slot='aui_user-message-root']") ? 'my' : 'your')

  // Hover ↩ button: one floating element that follows the hovered bubble.
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'hm-reply-btn'
  btn.setAttribute('aria-label', label('reply'))
  btn.innerHTML = REPLY_SVG

  const pill = document.createElement('button')
  pill.type = 'button'
  pill.className = 'hm-quote-pill'
  pill.innerHTML = REPLY_SVG
  const pillText = document.createElement('span')
  pillText.textContent = label('quote')
  pill.append(pillText)
  document.body.append(btn, pill)

  let hovered = null
  let hideTimer = 0
  const hideBtn = () => {
    btn.removeAttribute('data-show')
    hovered = null
  }
  const showBtn = bubble => {
    clearTimeout(hideTimer)
    hovered = bubble
    const r = bubble.getBoundingClientRect()
    const size = 28
    const left = whoseOf(bubble) === 'my' ? r.left - size - 6 : r.right + 6
    btn.style.left = `${Math.round(Math.max(4, Math.min(left, innerWidth - size - 4)))}px`
    btn.style.top = `${Math.round(Math.max(4, r.bottom - size - 2))}px`
    btn.setAttribute('data-show', '')
  }
  const onOver = e => {
    const el = elementOf(e.target)
    if (!el) return
    if (btn.contains(el)) {
      clearTimeout(hideTimer)
      return
    }
    const bubble = el.closest(BUBBLES)
    if (bubble && pill.hasAttribute('data-show')) return
    if (bubble) {
      showBtn(bubble)
    } else if (hovered) {
      clearTimeout(hideTimer)
      hideTimer = setTimeout(hideBtn, 250)
    }
  }
  btn.addEventListener('click', () => {
    if (!hovered) return
    const text = clipText(bubbleText(hovered), EXCERPT_MAX)
    if (text) setReply({ kind: 'reply', whose: whoseOf(hovered), text })
    hideBtn()
  })

  // Select text inside one bubble → a "Quote" pill above the selection.
  let quoteFrom = null
  const hidePill = () => {
    pill.removeAttribute('data-show')
    quoteFrom = null
  }
  const checkSelection = () => {
    const sel = document.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) return hidePill()
    const a = elementOf(sel.anchorNode)?.closest(BUBBLES)
    const f = elementOf(sel.focusNode)?.closest(BUBBLES)
    const text = sel.toString().trim()
    if (!a || a !== f || !text) return hidePill()
    const r = sel.getRangeAt(0).getBoundingClientRect()
    const below = r.top < 56
    pill.style.left = `${Math.round(r.left + r.width / 2)}px`
    pill.style.top = `${Math.round(below ? r.bottom + 10 : r.top - 10)}px`
    pill.toggleAttribute('data-below', below)
    quoteFrom = { kind: 'quote', whose: whoseOf(a), text: clipText(text, QUOTE_MAX) }
    hideBtn()
    pill.setAttribute('data-show', '')
  }
  const onUp = () => setTimeout(checkSelection, 0)
  const onKeyUp = e => e.shiftKey && onUp()
  const onSelChange = () => {
    const s = document.getSelection()
    if (!s || s.isCollapsed) hidePill()
  }
  pill.addEventListener('mousedown', e => e.preventDefault())
  pill.addEventListener('click', () => {
    if (!quoteFrom) return
    setReply(quoteFrom)
    document.getSelection()?.removeAllRanges()
    hidePill()
  })
  const onScroll = () => {
    hideBtn()
    hidePill()
  }

  // Sent replies: strip the wire prefix from your bubble and show a quote card.
  const renderQuote = span => {
    const m = REPLY_RE.exec(span.textContent)
    if (!m) return
    let remaining = m[0].length
    const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n && remaining > 0; n = walker.nextNode()) {
      const take = Math.min(n.data.length, remaining)
      remaining -= take
      n.data = n.data.slice(take)
      if (!n.data) {
        const box = n.parentElement?.closest('code, pre')
        if (box && span.contains(box)) box.setAttribute('data-hm-hidden', '')
      }
    }
    if (span.previousElementSibling?.classList.contains('hm-quote')) return
    const card = document.createElement('span')
    card.className = 'hm-quote'
    card.setAttribute('role', 'button')
    card.tabIndex = 0
    card.dataset.hmQuote = m[2]
    const who = document.createElement('span')
    who.className = 'hm-quote-who'
    who.textContent = label(m[1] === 'my' ? 'you' : 'agent')
    const body = document.createElement('span')
    body.className = 'hm-quote-text'
    body.textContent = m[2]
    card.append(who, body)
    span.before(card)
  }
  const renderAll = () => {
    for (const span of document.querySelectorAll("[data-slot='aui_user-message-root'] [data-slot='aui_user-message-text']")) {
      renderQuote(span)
    }
  }

  // Click a quote card → scroll to the original message and flash it.
  const jump = card => {
    const q = card.dataset.hmQuote.replace(/\s+/g, ' ').replace(/…$/, '').trim().slice(0, 60)
    if (!q) return
    const earlier = [...document.querySelectorAll(BUBBLES)].filter(
      b => !b.contains(card) && b.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING && bubbleText(b).includes(q)
    )
    const target = earlier.at(-1)
    if (!target) return
    target.scrollIntoView({ block: 'center', behavior: 'smooth' })
    target.removeAttribute('data-hm-flash')
    void target.offsetWidth
    target.setAttribute('data-hm-flash', '')
    setTimeout(() => target.removeAttribute('data-hm-flash'), 1500)
  }
  const onClick = e => {
    const card = elementOf(e.target)?.closest('.hm-quote')
    if (card) jump(card)
  }
  const onKey = e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target instanceof Element && e.target.matches('.hm-quote')) {
      e.preventDefault()
      jump(e.target)
    }
  }

  let frame = 0
  const observer = new MutationObserver(() => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(renderAll)
  })
  observer.observe(document.body, { childList: true, subtree: true })
  renderAll()

  document.addEventListener('pointerover', onOver)
  document.addEventListener('mouseup', onUp)
  document.addEventListener('keyup', onKeyUp)
  document.addEventListener('selectionchange', onSelChange)
  document.addEventListener('click', onClick)
  document.addEventListener('keydown', onKey)
  window.addEventListener('scroll', onScroll, true)

  onDispose(() => {
    observer.disconnect()
    cancelAnimationFrame(frame)
    clearTimeout(hideTimer)
    document.removeEventListener('pointerover', onOver)
    document.removeEventListener('mouseup', onUp)
    document.removeEventListener('keyup', onKeyUp)
    document.removeEventListener('selectionchange', onSelChange)
    document.removeEventListener('click', onClick)
    document.removeEventListener('keydown', onKey)
    window.removeEventListener('scroll', onScroll, true)
    btn.remove()
    pill.remove()
    for (const card of document.querySelectorAll('.hm-quote')) card.remove()
  })
}
// ─── end replies ────────────────────────────────────────────────────────────

// ─── UI ─────────────────────────────────────────────────────────────────────

function Row({ label, hint, children, inline }) {
  return jsxs('div', {
    className: inline ? 'hm-row-inline' : 'hm-row',
    children: [
      jsxs('div', {
        className: 'hm-row',
        style: { gap: '0.125rem' },
        children: [jsx('div', { className: 'hm-label', children: label }), hint && jsx('div', { className: 'hm-hint', children: hint })]
      }),
      children
    ]
  })
}

function Panel() {
  const t = usePluginI18n(ID)
  const s = useValue($settings)

  return jsxs('div', {
    className: 'hm-panel',
    children: [
      jsxs('div', {
        className: 'hm-head',
        children: [
          jsx(Codicon, { name: 'comment-discussion', size: '0.9375rem' }),
          jsx('span', { className: 'hm-title', children: t('title') })
        ]
      }),
      jsxs('div', {
        className: 'hm-preview',
        'data-style': s.style,
        'data-noise': s.noise,
        'aria-hidden': true,
        children: [
          jsx('span', { className: 'hm-out', children: t('previewOut') }),
          jsx('div', { className: 'hm-tool', children: '✓ Ran deploy.sh · 4s' }),
          jsx('span', { children: t('previewIn') })
        ]
      }),
      jsx(Row, {
        label: t('noise'),
        hint: t(`noiseHint.${s.noise}`),
        children: jsx(SegmentedControl, {
          className: 'w-full',
          value: s.noise,
          onChange: noise => {
            haptic('selection')
            update({ noise })
          },
          options: NOISE_ORDER.map(id => ({ id, label: t(id) }))
        })
      }),
      jsx(Row, {
        label: t('style'),
        hint: t('styleHint'),
        children: jsx(SegmentedControl, {
          className: 'w-full',
          value: s.style,
          onChange: style => {
            haptic('selection')
            update({ style })
          },
          options: [
            { id: 'bubbles', label: t('bubbles') },
            { id: 'classic', label: t('classic') }
          ]
        })
      }),
      jsx(Row, {
        inline: true,
        label: t('pin'),
        hint: t('pinHint'),
        children: jsx(Switch, { checked: s.pin, onCheckedChange: pin => update({ pin }), size: 'xs' })
      }),
      jsx(Row, {
        inline: true,
        label: t('motion'),
        hint: t('motionHint'),
        children: jsx(Switch, { checked: s.motion, onCheckedChange: motion => update({ motion }), size: 'xs' })
      })
    ]
  })
}

function ChipLabel() {
  const t = usePluginI18n(ID)
  const s = useValue($settings)

  return jsxs('span', {
    className: 'hm-chip',
    children: [jsx('span', { className: 'hm-chip-dot', 'data-level': s.noise }), t(s.noise)]
  })
}

function ReplyBar() {
  const t = usePluginI18n(ID)
  const r = useValue($reply)
  if (!r) return null
  const who = t(r.whose === 'my' ? 'you' : 'agent')
  return jsxs('div', {
    className: 'hm-replybar',
    children: [
      jsx('span', { className: 'hm-replybar-icon', dangerouslySetInnerHTML: { __html: REPLY_SVG } }),
      jsxs('div', {
        className: 'hm-replybar-body',
        children: [
          jsx('div', { className: 'hm-replybar-who', children: t(r.kind === 'quote' ? 'quotingFrom' : 'replyingTo', who) }),
          jsx('div', { className: 'hm-replybar-text', children: r.text })
        ]
      }),
      jsx('button', {
        type: 'button',
        className: 'hm-replybar-x',
        'aria-label': t('cancelReply'),
        onClick: () => $reply.set(null),
        children: jsx(Codicon, { name: 'close', size: '0.8125rem' })
      })
    ]
  })
}

// ─── Plugin ─────────────────────────────────────────────────────────────────

export default {
  id: ID,
  name: 'Messenger',
  description: 'Telegram/iMessage-style chat: bubbles, a typing indicator, spring motion, and a noise filter that shows only results.',
  register(ctx) {
    ctx.i18n.register(LOCALES)
    const t = (key, ...args) => ctx.i18n.t(key, ...args)

    const stored = ctx.storage.get('settings', null)
    $settings = atom({ ...DEFAULTS, ...(stored && typeof stored === 'object' ? stored : {}) })
    save = value => ctx.storage.set('settings', value)

    // Stylesheet + a tiny second sheet for the computed accent ink.
    const style = document.createElement('style')
    style.id = 'hermes-messenger-css'
    style.textContent = CSS
    const vars = document.createElement('style')
    vars.id = 'hermes-messenger-vars'
    document.head.append(style, vars)

    let inkFrame = 0
    const refreshInk = () => {
      cancelAnimationFrame(inkFrame)
      inkFrame = requestAnimationFrame(() => {
        const text = bubbleVars(resolveAccentHex())

        if (vars.textContent !== text) {
          vars.textContent = text
        }
      })
    }

    const themeObserver = new MutationObserver(refreshInk)
    themeObserver.observe(ROOT, { attributes: true, attributeFilter: ['class', 'style', 'data-hermes-theme', 'data-hermes-mode'] })
    refreshInk()

    applyAttributes($settings.get())
    const unlisten = $settings.listen(applyAttributes)

    ctx.onDispose(() => {
      unlisten()
      themeObserver.disconnect()
      cancelAnimationFrame(inkFrame)
      style.remove()
      vars.remove()
      clearAttributes()
    })

    // Hold ⌥ to peek at hidden work in "Results" mode.
    const setPeek = on => (on ? ROOT.setAttribute('data-hm-peek', '') : ROOT.removeAttribute('data-hm-peek'))
    ctx.addEventListener(window, 'keydown', e => {
      if (e.key === 'Alt' && !e.repeat && $settings.get().noise === 'results') {
        setPeek(true)
      }
    })
    ctx.addEventListener(window, 'keyup', e => e.key === 'Alt' && setPeek(false))
    ctx.addEventListener(window, 'blur', () => setPeek(false))

    createMotion(ctx)

    if (window.hermesDesktop?.readFileText) {
      createAttachmentPreviews({
        bridge: window.hermesDesktop,
        cwd: () => host.state.cwd?.get?.() || '',
        onDispose: fn => ctx.onDispose(fn)
      })
    }

    // Replies & quotes: hover ↩ / select → Quote, a bar above the input, and
    // the reply prepended on send through the official composer middleware.
    createReplies({
      label: key => t(key),
      setReply: r => {
        $reply.set(r)
        haptic('selection')
        host.composer?.focus?.(null)
      },
      onDispose: fn => ctx.onDispose(fn)
    })
    ctx.register({ id: 'reply-bar', area: COMPOSER_AREAS.top, render: () => jsx(ReplyBar, {}) })
    ctx.register({
      id: 'reply-send',
      area: COMPOSER_AREAS.middleware,
      data: {
        handler: draft => {
          const r = $reply.get()
          if (!r || !draft?.text?.trim()) return draft
          $reply.set(null)
          return { ...draft, text: replyWire(r) + draft.text }
        }
      }
    })
    const clearReply = () => $reply.set(null)
    for (const $a of [host.state.focusedSessionId, host.state.activeSessionId]) {
      if ($a?.listen) ctx.onDispose($a.listen(clearReply))
    }
    ctx.addEventListener(window, 'keydown', e => {
      if (e.key === 'Escape' && $reply.get() && !document.querySelector('[role="dialog"], [role="menu"]')) clearReply()
    })

    // Busy state drives the typing bubble.
    const $busy = host.state.busy
    const setBusy = on => (on ? ROOT.setAttribute('data-hm-busy', '') : ROOT.removeAttribute('data-hm-busy'))

    if ($busy?.subscribe) {
      ctx.onDispose($busy.subscribe(setBusy))
    }

    const announce = () => host.notify({ kind: 'info', message: t('toast', t($settings.get().noise)) })

    ctx.register({
      id: 'chip',
      area: STATUSBAR_AREAS.right,
      order: 5,
      data: {
        id: 'hermes-messenger',
        variant: 'menu',
        title: t('chipTip'),
        toggleLabel: t('name'),
        icon: jsx(Codicon, { name: 'comment-discussion', size: '0.8125rem' }),
        label: jsx(ChipLabel, {}),
        menuAlign: 'end',
        menuClassName: 'w-auto',
        menuContent: () => jsx(Panel, {})
      }
    })

    ctx.register({
      id: 'cycle-noise',
      area: KEYBINDS_AREA,
      data: {
        id: 'hermes-messenger.cycle-noise',
        label: t('cycle'),
        defaults: ['mod+alt+f'],
        run: () => {
          cycleNoise()
          haptic('selection')
          announce()
        }
      }
    })

    ctx.register({
      id: 'palette-cycle',
      area: PALETTE_AREA,
      data: {
        id: 'hermes-messenger.cycle',
        label: t('cycle'),
        action: 'hermes-messenger.cycle-noise',
        keywords: ['noise', 'focus', 'results', 'tools', 'quiet', 'messenger'],
        detail: () => t($settings.get().noise),
        detailVariant: 'state',
        keepOpen: true,
        run: () => {
          cycleNoise()
          haptic('selection')
        }
      }
    })

    ctx.register({
      id: 'palette-style',
      area: PALETTE_AREA,
      data: {
        id: 'hermes-messenger.style',
        label: t('toggleStyle'),
        keywords: ['bubbles', 'telegram', 'imessage', 'chat', 'style', 'messenger'],
        detail: () => t($settings.get().style),
        detailVariant: 'state',
        keepOpen: true,
        run: () => update({ style: $settings.get().style === 'bubbles' ? 'classic' : 'bubbles' })
      }
    })
  }
}
