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
 *   • Inbox strip: a live view of this Bot Chat's waiting deliveries, with
 *     Handle now / Skip for a still-queued one (confirm first).
 *
 * Mostly presentation: it restyles the app's stable `data-slot` hooks without
 * rewriting stored conversation messages. Two exceptions, via the plugin's own
 * dashboard backend (dashboard/inbox_api.py): it reads the Bot Chat delivery
 * queue, and on your confirmed Handle now / Skip it closes that one queued
 * delivery as cancelled (the sender gets a receipt) — Handle now then opens
 * the message in a new chat. Disabling restores the stock presentation;
 * it does not undo previous delivery cancellations or side-chat submissions.
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
import * as HermesSDK from '@hermes/plugin-sdk'
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

/* ── Live inbox strip ─────────────────────────────────────────────────── */
.hm-inbox { margin: 0 0 0.5rem; border: 0.0625rem solid var(--hm-in-stroke, var(--ui-stroke-tertiary)); border-radius: 0.75rem; background: color-mix(in srgb, var(--ui-base) 4%, transparent); overflow: hidden; }
.hm-inbox-head { display: flex; align-items: center; gap: 0.5rem; width: 100%; padding: 0.375rem 0.75rem; border: 0; background: none; color: var(--ui-text-secondary); font: inherit; font-size: 0.75rem; line-height: 1.25rem; text-align: left; cursor: pointer; }
.hm-inbox-head:hover { background: color-mix(in srgb, var(--ui-base) 5%, transparent); }
.hm-inbox-head:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: -2px; }
.hm-inbox-dot { flex: none; width: 0.5rem; height: 0.5rem; border-radius: 999px; background: #e0a526; }
.hm-inbox-dot[data-busy] { background: #34a853; box-shadow: 0 0 0 0 rgba(52,168,83,.5); animation: hm-inbox-pulse 1.8s ease-out infinite; }
@keyframes hm-inbox-pulse { to { box-shadow: 0 0 0 0.375rem rgba(52,168,83,0); } }
html[data-hm-motion='off'] .hm-inbox-dot[data-busy] { animation: none; }
.hm-inbox-title { flex: none; color: var(--ui-text-primary); font-weight: 600; }
.hm-inbox-sum { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.hm-inbox .hm-at-chev { margin-left: auto; }
.hm-inbox[data-open] .hm-at-chev { transform: translateY(0.15rem) rotate(-135deg); }
.hm-inbox-list { display: grid; gap: 0.125rem; max-height: min(24rem, 45vh); overflow-y: auto; overscroll-behavior: contain; padding: 0 0.5rem 0.625rem; scrollbar-width: thin; }
.hm-inbox-item { display: flex; align-items: flex-start; gap: 0.5rem; padding: 0.375rem 0.25rem; border-top: 0.0625rem solid color-mix(in srgb, var(--ui-base) 7%, transparent); }
.hm-inbox-pos { flex: none; width: 1.1rem; color: var(--ui-text-secondary); font-size: 0.6875rem; line-height: 1.25rem; text-align: right; font-variant-numeric: tabular-nums; }
.hm-inbox-item[data-status='claimed'] .hm-inbox-pos { color: #34a853; }
.hm-inbox-icon { flex: none; width: 1.1rem; font-size: 0.75rem; line-height: 1.25rem; text-align: center; }
.hm-inbox-main { display: grid; min-width: 0; flex: 1; }
.hm-inbox-line { display: flex; gap: 0.5rem; align-items: baseline; min-width: 0; font-size: 0.75rem; line-height: 1.25rem; }
.hm-inbox-from { min-width: 0; overflow: hidden; color: var(--ui-text-primary); font-weight: 600; white-space: nowrap; text-overflow: ellipsis; }
.hm-inbox-age { flex: none; margin-left: auto; color: var(--ui-text-secondary); font-variant-numeric: tabular-nums; }
.hm-inbox-item[data-status='claimed'] .hm-inbox-age { color: #34a853; }
.hm-inbox-item[data-stuck] .hm-inbox-age { color: #d4453c; font-weight: 600; }
.hm-inbox-stuck { margin-top: 0.1875rem; color: #d4453c; font-size: 0.6875rem; line-height: 1rem; }
.hm-inbox-preview { overflow: hidden; color: var(--ui-text-secondary); font-size: 0.75rem; line-height: 1.125rem; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.hm-inbox-acts { display: flex; flex-wrap: wrap; align-items: center; gap: 0.375rem; margin-top: 0.3125rem; }
.hm-inbox-q { flex-basis: 100%; color: var(--ui-text-primary); font-size: 0.75rem; line-height: 1.125rem; }
.hm-inbox-btn { padding: 0.125rem 0.625rem; border: 0.0625rem solid var(--hm-in-stroke, var(--ui-stroke-tertiary)); border-radius: 999px; background: none; color: var(--ui-text-primary); font: inherit; font-size: 0.6875rem; line-height: 1.125rem; cursor: pointer; }
.hm-inbox-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--ui-base) 8%, transparent); }
.hm-inbox-btn:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 1px; }
.hm-inbox-btn:disabled { opacity: 0.5; cursor: default; }
.hm-inbox-btn[data-primary] { border-color: transparent; background: var(--ui-accent); color: #fff; }
.hm-inbox-btn[data-danger] { color: #e5534b; }
.hm-inbox-note { color: var(--ui-text-secondary); font-size: 0.6875rem; }
.hm-inbox-foot { padding: 0.375rem 0.25rem 0; color: var(--ui-text-tertiary); font-size: 0.6875rem; }
.hm-inbox-parked { display: flex; flex-wrap: wrap; align-items: center; gap: 0.375rem; padding: 0.375rem 0.75rem 0.5rem; border-top: 0.0625rem solid color-mix(in srgb, var(--ui-base) 7%, transparent); animation: hm-inbox-in 0.24s ease-out; }
.hm-inbox-parked[data-maybe] .hm-inbox-q { color: #e0a526; }
@keyframes hm-inbox-in { from { opacity: 0; transform: translateY(-0.25rem); } }
html[data-hm-motion='off'] .hm-inbox-parked { animation: none; }
@media (prefers-reduced-motion: reduce) { .hm-inbox-parked, .hm-inbox-dot[data-busy] { animation: none; } }

/* ── System cards (cron reports, kanban alerts) ─────────────────────────── */
[data-hm-sys] { align-items: flex-start !important; }
[data-hm-sys] > :not(.hm-sys) { display: none !important; }
.hm-sys {
  box-sizing: border-box; width: min(88%, 42rem); margin: 0.25rem 0; padding: 0.625rem 0.875rem 0.75rem;
  border: 0.0625rem solid var(--hm-in-stroke, var(--ui-stroke-tertiary)); box-shadow: inset 0.1875rem 0 0 var(--hm-sys-tone, var(--ui-text-tertiary)); padding-left: 1rem;
  border-radius: 0.75rem; background: color-mix(in srgb, var(--ui-base) 4%, transparent); color: var(--ui-text-primary);
}
.hm-sys[data-kind='cron'] { --hm-sys-tone: #8e7cf0; }
.hm-sys[data-state='blocked'], .hm-sys[data-state='timeout'], .hm-sys[data-state='warn'] { --hm-sys-tone: #e0a526; }
.hm-sys[data-state='done'] { --hm-sys-tone: #34a853; }
.hm-sys[data-state='crashed'], .hm-sys[data-state='changes'] { --hm-sys-tone: #e5484d; }
.hm-sys[data-state='status'], .hm-sys[data-state='review'] { --hm-sys-tone: #3b82f6; }
.hm-sys-head { display: flex; align-items: baseline; gap: 0.5rem; min-width: 0; font-size: 0.75rem; line-height: 1.25rem; }
.hm-sys-icon { flex: none; width: 1.1em; color: var(--hm-sys-tone); text-align: center; }
.hm-sys-title { min-width: 0; overflow: hidden; font-weight: 600; white-space: nowrap; text-overflow: ellipsis; }
.hm-sys-meta { flex: none; margin-left: auto; color: var(--ui-text-secondary); white-space: nowrap; }
.hm-sys-body { margin-top: 0.375rem; font-size: 0.8125rem; line-height: 1.45; overflow-wrap: anywhere; }
.hm-sys-body p, .hm-sys-body ul { margin: 0 0 0.5rem; }
.hm-sys-body > :last-child { margin-bottom: 0; }
.hm-sys-body ul { padding-left: 1.1rem; list-style: disc; }
.hm-sys-body a { color: var(--ui-accent); text-decoration: underline; text-underline-offset: 0.15em; }
.hm-sys-body code { font-size: 0.75rem; }
.hm-sys[data-long]:not([data-open]) .hm-sys-body { max-height: 6.5rem; overflow: hidden; -webkit-mask-image: linear-gradient(#000 60%, transparent); mask-image: linear-gradient(#000 45%, transparent); }
.hm-sys[data-long] .hm-sys-body { margin-bottom: 0; }
.hm-sys-more { display: block; margin-top: 0.375rem; padding: 0; border: 0; background: none; color: var(--ui-accent); font: inherit; font-size: 0.75rem; cursor: pointer; }
.hm-sys-more:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }

/* ── Bot-to-bot threads ────────────────────────────────────────────────── */
.hm-at-group { display: grid; justify-items: center; gap: 0.375rem; margin: 0.25rem 0; }
.hm-at { width: min(88%, 40rem); margin: 0.25rem auto; align-self: center; }
.hm-at:not([data-open]) { width: fit-content; max-width: min(88%, 40rem); }
.hm-at-head {
  display: inline-flex; align-items: center; gap: 0.5rem; max-width: 100%;
  padding: 0.25rem 0.75rem 0.25rem 0.3125rem; border: 0.0625rem solid var(--hm-in-stroke, var(--ui-stroke-tertiary));
  border-radius: 999px; background: color-mix(in srgb, var(--ui-base) 4%, transparent);
  color: var(--ui-text-secondary); font: inherit; font-size: 0.75rem; line-height: 1.25rem; cursor: pointer; text-align: left;
  transition: background 0.15s var(--hm-ease, ease);
}
.hm-at-head:hover { background: color-mix(in srgb, var(--ui-base) 8%, transparent); }
.hm-at-head:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.hm-at-faces { display: inline-flex; flex: none; }
.hm-at-faces .hm-at-avatar + .hm-at-avatar { margin-left: -0.375rem; box-shadow: 0 0 0 0.125rem var(--ui-bg-primary, #fff); }
.hm-at-avatar {
  display: inline-grid; place-items: center; flex: none; width: 1.375rem; height: 1.375rem; overflow: hidden;
  border-radius: 999px; background: color-mix(in srgb, var(--ui-base) 12%, transparent);
  color: var(--ui-text-primary); font-size: 0.75rem; font-weight: 600; line-height: 1;
}
.hm-at-avatar img { width: 100%; height: 100%; object-fit: cover; }
.hm-at-avatar[data-face] { overflow: visible; border-radius: 0; background: none !important; }
.hm-at-avatar[data-face] svg { display: block; width: 100%; height: 100%; }
.hm-at-faces .hm-at-avatar[data-face] + .hm-at-avatar { box-shadow: none; }
.hm-at-title { overflow: hidden; color: var(--ui-text-primary); font-weight: 500; white-space: nowrap; text-overflow: ellipsis; }
.hm-at-meta { flex: none; color: var(--ui-text-secondary); white-space: nowrap; }
.hm-at[data-state='failed'] .hm-at-meta { color: #d93b3b; }
.hm-at-chev { flex: none; width: 0.4rem; height: 0.4rem; margin: 0 0.125rem 0.125rem 0.125rem; border: solid currentColor; border-width: 0 0.09rem 0.09rem 0; transform: rotate(45deg); opacity: 0.6; transition: transform 0.15s var(--hm-ease, ease); }
.hm-at[data-open] .hm-at-chev { transform: translateY(0.15rem) rotate(-135deg); }
.hm-at-body { display: none; gap: 0.625rem; margin-top: 0.5rem; padding: 0.625rem 0 0.25rem 0.75rem; border-left: 0.125rem solid color-mix(in srgb, var(--ui-base) 10%, transparent); }
.hm-at[data-open] .hm-at-body { display: grid; }
.hm-at-msg { display: flex; align-items: flex-end; gap: 0.5rem; }
.hm-at-msg .hm-at-avatar { width: 1.625rem; height: 1.625rem; font-size: 0.875rem; }
.hm-at-col { display: grid; gap: 0.125rem; min-width: 0; max-width: 82%; }
.hm-at-name { padding: 0 0.625rem; color: var(--ui-text-secondary); font-size: 0.6875rem; font-weight: 600; line-height: 1rem; }
.hm-at-bubble {
  width: fit-content; max-width: 100%; padding: 0.4375rem 0.75rem; overflow-wrap: anywhere;
  border-radius: var(--hm-r, 1rem) var(--hm-r, 1rem) var(--hm-r, 1rem) var(--hm-tail, 0.375rem);
  background: var(--hm-in-bg, color-mix(in srgb, var(--ui-base) 8%, transparent)); color: var(--ui-text-primary);
  font-size: 0.8125rem; line-height: 1.4; white-space: pre-wrap;
}
.hm-at-bubble > div { margin: 0 !important; padding: 0 !important; border: 0 !important; max-width: none !important; font-size: inherit !important; white-space: normal; }
.hm-at-msg[data-side='self'] { flex-direction: row-reverse; }
.hm-at-msg[data-side='self'] .hm-at-col { justify-items: end; }
.hm-at-msg[data-side='self'] .hm-at-bubble {
  border-radius: var(--hm-r, 1rem) var(--hm-r, 1rem) var(--hm-tail, 0.375rem) var(--hm-r, 1rem);
  background: color-mix(in srgb, var(--ui-base) 13%, transparent);
}
.hm-at-avatar[data-self] { background: color-mix(in srgb, var(--ui-base) 22%, transparent); }
.hm-at-bubble code { font-size: 0.75rem; }
html[data-hm-motion='off'] .hm-at-head, html[data-hm-motion='off'] .hm-at-chev { transition: none; }

/* App bug fix: Tailwind Typography's \`.prose img { margin: 2em 0 }\` beats the
   image's \`m-0\` (same specificity, later in the sheet), so an inline image is
   pushed 2em down inside its fixed-size frame and covers the next paragraph. */
html[data-hm] :is([data-slot='aui_markdown-image'], [data-slot='aui_generated-image'], [data-slot='aui_zoomable-image']) img {
  margin: 0;
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

/* ── Attention: "Needs you" stands out, "no action needed" folds away ── */

.hm-attn { display: none; }
html[data-hm-noise='calm'] .hm-attn, html[data-hm-noise='results'] .hm-attn { display: flex; }
.hm-attn[data-kind='needs'] {
  align-items: center; gap: 0.375rem; width: fit-content; margin: 0 0 0.25rem;
  padding: 0.0625rem 0.5rem; border-radius: 999px; background: #e0a526; color: #1b1405;
  font-size: 0.6875rem; font-weight: 600; line-height: 1.125rem;
}
html:is([data-hm-noise='calm'], [data-hm-noise='results']) [data-hm-attn='needs'] [data-slot='aui_assistant-message-content'] {
  box-shadow: inset 0.1875rem 0 0 #e0a526; border-radius: 0.375rem;
}
.hm-attn[data-kind='fyi'] {
  align-items: center; gap: 0.375rem; width: 100%; box-sizing: border-box; padding: 0.125rem 0.625rem; border: 0; border-radius: 999px;
  background: color-mix(in srgb, var(--ui-base) 5%, transparent); color: var(--ui-text-secondary);
  font: inherit; font-size: 0.75rem; line-height: 1.25rem; text-align: left; cursor: pointer;
}
.hm-attn[data-kind='fyi']:hover { color: var(--ui-text-secondary); }
.hm-attn[data-kind='fyi']:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 1px; }
.hm-attn-tag { flex: none; font-weight: 500; color: var(--ui-text-tertiary); }
.hm-attn-text { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; min-width: 0; }
html[data-hm-noise='calm'] [data-hm-attn='fyi']:not([data-hm-open]) [data-slot='aui_assistant-message-content'] { display: none !important; }
html[data-hm-noise='results']:not([data-hm-peek]) [data-hm-attn='fyi'] { display: none !important; }
html[data-hm-noise='results'][data-hm-peek] [data-hm-attn='fyi'] .hm-attn { display: none; }

/* System nudges: a small centred note, not the user's bubble. */
[data-hm-nudge] { align-items: center !important; }
[data-hm-nudge] > :not(.hm-nudge) { display: none !important; }
[data-hm-nudge][data-hm-open] .hm-nudge { align-items: flex-start; border-radius: 0.75rem; }
[data-hm-nudge][data-hm-open] .hm-nudge .hm-attn-text { white-space: normal; overflow: visible; }
[data-hm-nudge] + div:has(> [data-slot='aui_directive-text']) { display: none !important; }
.hm-nudge {
  display: flex; align-items: center; gap: 0.375rem; align-self: center; max-width: min(86%, 36rem);
  margin: 0.125rem auto; padding: 0.0625rem 0.625rem; border: 0; border-radius: 999px;
  background: color-mix(in srgb, var(--ui-base) 5%, transparent); color: var(--ui-text-secondary);
  font: inherit; font-size: 0.6875rem; line-height: 1.125rem; text-align: left; cursor: pointer;
}
.hm-nudge:hover { color: var(--ui-text-primary); }
.hm-nudge:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 1px; }
html[data-hm-noise='results']:not([data-hm-peek]) [data-hm-nudge] { display: none !important; }

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
  min-width: 0;
  max-width: 100%;
  grid-template-columns: minmax(0, 1fr);
  justify-items: stretch;
  gap: 0.5rem;
}
/* Content-sized textareas must not set the implicit grid's min-content
   width. One long URL otherwise widens every option beyond the card. */
html[data-hm-style='bubbles'] [data-slot='clarify-inline'],
html[data-hm-style='bubbles'] [data-slot='clarify-inline'] :is([data-clarify-batch-question], [role='group']) {
  min-width: 0;
  grid-template-columns: minmax(0, 1fr);
  overflow-wrap: anywhere;
}
html[data-hm-style='bubbles'] [data-slot='clarify-inline'] {
  box-sizing: border-box;
  width: 100%;
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
  flex: 1 1 0%;
  width: 0;
  min-width: 0;
  max-width: 100%;
  max-height: 10rem;
  overflow-y: auto;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
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
html[data-hm-style='bubbles'] [data-slot='clarify-inline'] > [data-slot='textarea'],
html[data-hm-style='bubbles'] [data-slot='clarify-inline'] [data-clarify-batch-question] > [data-slot='textarea'] {
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
  width: 1.75rem; height: 1.75rem; box-sizing: border-box; line-height: 0; padding: 0; border: 0.0625rem solid var(--hm-in-stroke, rgb(0 0 0 / 0.08));
  border-radius: 999px; background: var(--ui-bg-primary, #fff); color: var(--ui-text-secondary, #666);
  box-shadow: 0 0.125rem 0.5rem rgb(0 0 0 / 0.12); cursor: pointer;
  opacity: 0; pointer-events: none; transform: scale(0.85);
  transition: opacity 0.12s ease, transform 0.18s var(--hm-spring, ease);
}
.hm-reply-btn[data-show] { opacity: 1; pointer-events: auto; transform: none; }
.hm-reply-btn:hover { color: var(--hm-out-bg, var(--ui-accent)); }
.hm-reply-btn svg { display: block; width: 0.875rem; height: 0.875rem; margin: auto; }
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
    cancelReply: 'Cancel reply',
    scheduledJob: 'Scheduled job',
    inboxTitle: 'Inbox',
    inboxWaiting: n => `${n} waiting`,
    inboxStuckCount: n => `${n} stuck`,
    inboxStuckAge: a => `stuck · ${a}`,
    inboxStuckHint: 'Hermes will never pick this up: it was queued for an earlier session (before a restart). Handle it now or skip it.',
    inboxHandling: 'handling 1',
    inboxOldest: a => `oldest ${a}`,
    inboxAge: a => `waiting ${a}`,
    inboxNow: a => `handling now · ${a}`,
    inboxUnknown: 'Delivery',
    inboxMedian: m => `Typical wait today: ${m} min. The bot takes these one at a time when this chat is idle.`,
    attnNeeds: 'Needs you',
    attnFyi: 'No action',
    attnRepeat: 'Repeated',
    attnShow: 'Show',
    sysNudge: 'Automatic system note',
    inboxTake: 'Handle now',
    inboxSkip: 'Skip',
    inboxConfirmTake: 'Take this out of the line and open it in a new chat now?',
    inboxConfirmSkip: 'Remove this without handling it? The sender is told it was skipped.',
    inboxConfirm: 'Confirm',
    inboxCancel: 'Cancel',
    inboxWorking: 'Working…',
    inboxTaken: 'Opened in a new chat.',
    inboxSkipped: 'Skipped.',
    inboxGone: 'Too late: the bot already started on it, or it is gone.',
    inboxFailed: 'That did not work. Nothing was changed.',
    inboxOpenFailed: 'Taken out of the line, but the new chat did not open. The message is in your message box.',
    inboxUnsure: 'No answer from Hermes. It may already be out of the line; check the list before trying again.',
    inboxOpenSent: title => `Sent to “${title}”, but that chat did not open. Find it in your chat list; do not send it again.`,
    inboxMaybeSent: title => `Taken out of the line. “${title}” may already have received it; check that chat before sending it again.`,
    inboxParkedNote: title => `Taken out of the line, but “${title}” did not open. The message is kept here.`,
    inboxPlace: 'Put in message box',
    inboxPlaceAnyway: 'Put in message box anyway',
    inboxDismiss: 'Dismiss',
    inboxChatTitle: from => `Inbox · ${from}`,
    showMore: 'Show more',
    showLess: 'Show less',
    kb_blocked: 'Task blocked',
    kb_done: 'Task done',
    kb_timeout: 'Task timed out',
    kb_crashed: 'Worker stopped',
    kb_changes: 'Changes requested',
    kb_status: 'Task status',
    kb_review: 'Review requested',
    kb_warn: 'Task warning',
    teammate: 'Teammate',
    messages: n => (n === 1 ? '1 message' : `${n} messages`),
    replied: 'replied',
    received: 'received',
    delivered: 'delivered, no reply',
    failed: 'not delivered'
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
    cancelReply: 'Отменить ответ',
    teammate: 'Коллега',
    scheduledJob: 'Задание по расписанию',
    inboxTitle: 'Входящие',
    inboxWaiting: n => `ждут: ${n}`,
    inboxStuckCount: n => `застряли: ${n}`,
    inboxStuckAge: a => `застряло · ${a}`,
    inboxStuckHint: 'Hermes никогда его не возьмёт: оно было поставлено в очередь для прежней сессии (до перезапуска). Разберите сейчас или пропустите.',
    inboxHandling: 'обрабатывается 1',
    inboxOldest: a => `старшее ${a}`,
    inboxAge: a => `ждёт ${a}`,
    inboxNow: a => `обрабатывается · ${a}`,
    inboxUnknown: 'Доставка',
    inboxMedian: m => `Обычное ожидание сегодня: ${m} мин. Бот берёт их по одному, когда чат свободен.`,
    attnNeeds: 'Нужно ваше решение',
    attnFyi: 'Без действий',
    attnRepeat: 'Повтор',
    attnShow: 'Показать',
    sysNudge: 'Автоматическое системное сообщение',
    inboxTake: 'Разобрать сейчас',
    inboxSkip: 'Пропустить',
    inboxConfirmTake: 'Убрать из очереди и открыть в новом чате?',
    inboxConfirmSkip: 'Удалить без обработки? Отправитель узнает, что сообщение пропущено.',
    inboxConfirm: 'Подтвердить',
    inboxCancel: 'Отмена',
    inboxWorking: 'Выполняется…',
    inboxTaken: 'Открыто в новом чате.',
    inboxSkipped: 'Пропущено.',
    inboxGone: 'Поздно: бот уже взялся за него, или его нет.',
    inboxFailed: 'Не получилось. Ничего не изменено.',
    inboxOpenFailed: 'Убрано из очереди, но новый чат не открылся. Сообщение — в поле ввода.',
    inboxUnsure: 'Hermes не ответил. Возможно, сообщение уже убрано из очереди; проверьте список, прежде чем повторять.',
    inboxOpenSent: title => `Отправлено в «${title}», но чат не открылся. Найдите его в списке чатов; повторно не отправляйте.`,
    inboxMaybeSent: title => `Убрано из очереди. Возможно, «${title}» уже получил сообщение; проверьте этот чат, прежде чем отправлять снова.`,
    inboxParkedNote: title => `Убрано из очереди, но «${title}» не открылся. Сообщение сохранено здесь.`,
    inboxPlace: 'Вставить в поле ввода',
    inboxPlaceAnyway: 'Всё равно вставить',
    inboxDismiss: 'Скрыть',
    inboxChatTitle: from => `Входящие · ${from}`,
    showMore: 'Показать полностью',
    showLess: 'Свернуть',
    kb_blocked: 'Задача заблокирована',
    kb_done: 'Задача выполнена',
    kb_timeout: 'Время задачи вышло',
    kb_crashed: 'Исполнитель остановился',
    kb_changes: 'Нужны правки',
    kb_status: 'Статус задачи',
    kb_review: 'Нужна проверка',
    kb_warn: 'Предупреждение',
    messages: n => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'сообщение' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'сообщения' : 'сообщений'}`,
    replied: 'ответил',
    received: 'получено',
    delivered: 'доставлено, без ответа',
    failed: 'не доставлено'
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
    const gap = 8
    const left = whoseOf(bubble) === 'my' ? r.left - size - gap : r.right + gap
    // Vertically centred on the part of the bubble you can see, like a
    // messenger's swipe-to-reply arrow — not hanging off its bottom corner.
    const top = Math.max(r.top, 4)
    const bottom = Math.min(r.bottom, innerHeight - 4)
    const mid = bottom > top ? (top + bottom) / 2 : r.top + r.height / 2
    btn.style.left = `${Math.round(Math.max(4, Math.min(left, innerWidth - size - 4)))}px`
    btn.style.top = `${Math.round(Math.max(4, Math.min(mid - size / 2, innerHeight - size - 4)))}px`
    btn.setAttribute('data-show', '')
  }
  const onOver = e => {
    const el = elementOf(e.target)
    if (!el) return
    if (btn.contains(el)) {
      clearTimeout(hideTimer)
      return
    }
    let bubble = el.closest(BUBBLES)
    // Nothing to reply to on automatic system notes or system cards.
    const turn = bubble?.closest("[data-slot='aui_user-message-root']")
    if (turn && (turn.hasAttribute('data-hm-nudge') || turn.hasAttribute('data-hm-sys') || (typeof isSysNudge === 'function' && isSysNudge(turn)))) bubble = null
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

// ─── Live inbox strip ───────────────────────────────────────────────────────
// A bot takes Bot Chat deliveries (cron reports, teammate messages) one at a
// time and only when its chat is idle, so they can wait many minutes unseen.
// This strip shows that queue live above the composer of the chat it belongs
// to. GET /inbox lists the queue; Handle now / Skip (POST, after a confirm)
// withdraw one waiting delivery through the backend (dashboard/inbox_api.py).

const $inbox = atom(null) // { sessionId, owner, key, items, medianWait, actions } | null
const $inboxOpen = atom(false)
const $inboxAsk = atom(null) // { id, action, key, busy?, note? }
// A taken message that could not be handed to its new chat, parked with the
// Bot Chat it came from so it is never shown in another profile's composer.
const $inboxParked = atom(null) // { key, sessionId, text, title, maybeSent } | null
let inboxDeps = null // { rest, refresh, current } set by the poller

// Which Bot Chat a result belongs to: connection + profile + stored session.
const inboxKey = (owner, sid) => `${owner?.connectionId || ''}|${owner?.profile || 'default'}|${sid || ''}`

function inboxAge(seconds) {
  if (!seconds) return ''
  const m = Math.max(0, Math.round((Date.now() / 1000 - seconds) / 60))
  return m < 1 ? '<1m' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}

function startInboxPoller({ rest, sessionId, owner, watch = [], onDispose }) {
  let timer = 0
  let stopped = false
  let failures = 0
  let gen = 0 // only the newest tick may publish a result or schedule the next one
  const current = () => {
    const sid = sessionId()
    const who = owner?.() || null
    return { sid, owner: who, key: inboxKey(who, sid) }
  }
  const tick = async () => {
    if (stopped) return
    const mine = ++gen
    clearTimeout(timer)
    const at = current() // owner/session captured BEFORE the request
    if (at.sid && !document.hidden) {
      try {
        const r = await rest('/inbox', { timeoutMs: 8000 })
        if (stopped || mine !== gen) return
        failures = 0
        if (current().key !== at.key) {
          // Focus moved while the request was in flight: drop the answer.
          $inbox.set(null)
        } else {
          const ours = r?.bot_chat_session_id && r.bot_chat_session_id === at.sid
          const items = ours ? (r.items || []).filter(i => !i.session_id || i.session_id === at.sid) : []
          $inbox.set(ours ? { sessionId: at.sid, owner: at.owner, key: at.key, items, medianWait: r.median_wait_min_24h, actions: r.actions === true } : null)
        }
      } catch {
        if (stopped || mine !== gen) return
        failures++
        $inbox.set(null)
      }
    } else if (!at.sid) {
      $inbox.set(null)
    }
    // Backend missing (plugin not enabled) → back off instead of hammering.
    timer = setTimeout(tick, failures ? Math.min(60000, 5000 * 2 ** failures) : 5000)
  }
  const deps = { rest, current, refresh: () => tick() }
  inboxDeps = deps
  tick()
  const vis = () => !document.hidden && tick()
  document.addEventListener('visibilitychange', vis)
  // Focus moved to another chat or profile: hide the old strip at once and
  // re-check for the new one (any answer still in flight is now obsolete).
  const moved = () => {
    if (stopped) return
    if ($inbox.get()?.key !== current().key) $inbox.set(null)
    tick()
  }
  const unwatch = watch.map(listen => listen(moved))
  onDispose(() => {
    for (const u of unwatch) typeof u === 'function' && u()
    stopped = true
    gen++
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', vis)
    $inbox.set(null)
    if (inboxDeps === deps) inboxDeps = null
  })
}

// The message handed to the side chat: a one-line frame so the bot knows it
// was pulled out of its Bot Chat queue, then the delivery exactly as it came.
function inboxChatPrompt(item, message) {
  return `[Pulled from my Bot Chat inbox to handle here now${item.from ? ` · from ${item.from}` : ''}]\n\n${message}`
}

// Open a NEW chat with the inbox's bot and send it the message. Same door the
// Bot roster uses for a first open: create (lazy) → materialize → prompt →
// show, with the owner socket held across the sequence (#93602).
// A failure is tagged with how far it got: 'before' = the prompt was never
// sent, 'maybe' = prompt.submit itself failed (it may still have run),
// 'sent' = the prompt was accepted and only showing the chat failed.
async function openInboxChat(owner, title, text) {
  const profile = owner?.profile || 'default'
  const route = owner?.connectionId ? { connectionId: owner.connectionId, mode: 'local', profile, targetProfile: profile } : profile
  const call = (m, p) => (typeof host.requestProfile === 'function' ? host.requestProfile(route, m, p, undefined, { spawnPriority: 'foreground' }) : host.request(m, p))
  const fail = (stage, e) => Object.assign(new Error(String(e?.message || e || 'failed')), { stage })
  const release = typeof host.retainProfile === 'function' ? await host.retainProfile(route, { spawnPriority: 'foreground' }).catch(() => () => {}) : () => {}
  let stored
  try {
    let runtime
    try {
      const res = await call('session.create', { profile, title })
      runtime = res?.session_id
      stored = res?.stored_session_id
    } catch (e) {
      throw fail('before', e)
    }
    if (!runtime || !stored) throw fail('before', 'no session')
    await call('session.title', { session_id: runtime, title }).catch(() => {})
    try {
      await call('prompt.submit', { session_id: runtime, text })
    } catch (e) {
      throw fail('maybe', e)
    }
    try {
      await host.openSession(stored, { profile, intent: 'tab', tabTitle: title, awaitHydration: false })
    } catch (e) {
      throw fail('sent', e)
    }
  } finally {
    release()
  }
}

// POST failures: 409/404 = someone else already took it; 400/401/403/501 =
// refused before anything was touched; anything else (timeout, dropped
// connection, 5xx) = unknown, the withdrawal may have committed.
function inboxPostOutcome(e) {
  const s = String(e?.status || e?.message || e)
  if (/\b(409|404)\b/.test(s)) return 'inboxGone'
  if (/\b(400|401|403|501)\b/.test(s)) return 'inboxFailed'
  return 'inboxUnsure'
}

// Put a parked message into the message box, but only while the Bot Chat it
// came from is the focused chat. Returns false (still parked) otherwise.
async function placeParked(parked) {
  const now = inboxDeps?.current?.()
  if (!parked || !now || now.key !== parked.key) return false
  const ok = await host.composer?.setDraft?.(null, parked.text)
  if (ok === false) return false
  if ($inboxParked.get() === parked) $inboxParked.set(null)
  return true
}

async function runInboxAction(item, action, t) {
  const deps = inboxDeps
  const box = $inbox.get()
  if (!deps || !box) return
  // The confirm belongs to the Bot Chat it was shown in; never act for another.
  if (deps.current().key !== box.key || !box.items.some(i => i.id === item.id)) {
    $inboxAsk.set(null)
    return
  }
  const key = box.key
  const owner = box.owner
  const title = t('inboxChatTitle', item.from || t('inboxUnknown'))
  $inboxAsk.set({ id: item.id, action, key, busy: true })
  const settle = next => {
    const cur = $inboxAsk.get()
    if (cur && cur.id === item.id && cur.key === key) $inboxAsk.set(next)
  }
  let res
  try {
    res = await deps.rest(`/inbox/${encodeURIComponent(item.id)}/${action}`, { method: 'POST', timeoutMs: 15000 })
  } catch (e) {
    const outcome = inboxPostOutcome(e)
    settle({ id: item.id, action, key, note: t(outcome) })
    // The row may vanish on refresh if it did commit; keep the warning visible.
    if (outcome === 'inboxUnsure') host.notify?.({ kind: 'error', message: t(outcome) })
    if (inboxDeps === deps) deps.refresh()
    return
  }
  if (action === 'skip') {
    settle(null)
    host.notify?.({ kind: 'info', message: t('inboxSkipped') })
    haptic?.('selection')
    if (inboxDeps === deps) deps.refresh()
    return
  }
  const text = inboxChatPrompt(item, res?.message || '')
  settle(null)
  if (inboxDeps === deps) deps.refresh()
  try {
    await openInboxChat(owner, title, text)
    host.notify?.({ kind: 'info', message: t('inboxTaken') })
  } catch (e) {
    if (e?.stage === 'sent') {
      // The bot already has it in the new chat; offering the text again
      // would invite a duplicate. Point at the chat instead.
      host.notify?.({ kind: 'error', message: t('inboxOpenSent', title) })
      return
    }
    // Out of the line but not (certainly) delivered: keep it with its own
    // Bot Chat. It only enters the message box while that chat is focused.
    const parked = { key, sessionId: box.sessionId, text, title, maybeSent: e?.stage === 'maybe' }
    $inboxParked.set(parked)
    if (!parked.maybeSent && (await placeParked(parked))) {
      host.notify?.({ kind: 'error', message: t('inboxOpenFailed') })
      return
    }
    host.notify?.({ kind: 'error', message: t(parked.maybeSent ? 'inboxMaybeSent' : 'inboxParkedNote', title) })
  }
}

function InboxStrip() {
  const t = usePluginI18n(ID)
  const box = useValue($inbox)
  const open = useValue($inboxOpen)
  const rawAsk = useValue($inboxAsk)
  const rawParked = useValue($inboxParked)
  const ask = rawAsk && box && rawAsk.key === box.key ? rawAsk : null
  const parked = rawParked && box && rawParked.key === box.key ? rawParked : null
  if (!box || (!box.items.length && !parked)) return null
  if (!box.items.length) return jsx('div', { className: 'hm-inbox', 'data-open': '', children: jsx(InboxParked, { parked, t }) })
  const handling = box.items.find(i => i.status === 'claimed')
  const waiting = box.items.filter(i => i.status === 'queued' && !i.stuck)
  const stuck = box.items.filter(i => i.status === 'queued' && i.stuck)
  const oldest = waiting[0]
  const kindIcon = k => (k === 'cron' ? '⏱' : k === 'agent' ? '🤖' : k === 'kanban' ? '▦' : '✉')
  const summary = [
    waiting.length ? t('inboxWaiting', waiting.length) : null,
    handling ? t('inboxHandling') : null,
    oldest ? t('inboxOldest', inboxAge(oldest.created_at)) : null,
    stuck.length ? t('inboxStuckCount', stuck.length) : null
  ].filter(Boolean).join(' · ')
  return jsxs('div', {
    className: 'hm-inbox',
    'data-open': open ? '' : undefined,
    children: [
      jsxs('button', {
        type: 'button',
        className: 'hm-inbox-head',
        'aria-expanded': String(open),
        onClick: () => $inboxOpen.set(!open),
        children: [
          jsx('span', { className: 'hm-inbox-dot', 'data-busy': handling ? '' : undefined }),
          jsx('span', { className: 'hm-inbox-title', children: t('inboxTitle') }),
          jsx('span', { className: 'hm-inbox-sum', children: summary }),
          jsx('span', { className: 'hm-at-chev', 'aria-hidden': 'true' })
        ]
      }),
      parked && jsx(InboxParked, { parked, t }),
      open &&
        jsxs('div', {
          className: 'hm-inbox-list',
          children: [
            ...box.items.map((i, n) =>
              jsxs('div', {
                className: 'hm-inbox-item',
                'data-status': i.status,
                'data-stuck': i.stuck ? '' : undefined,
                key: i.id,
                children: [
                  jsx('span', { className: 'hm-inbox-pos', children: i.status === 'claimed' ? '▶' : String(n + (handling ? 0 : 1)) }),
                  jsx('span', { className: 'hm-inbox-icon', children: kindIcon(i.kind) }),
                  jsxs('div', {
                    className: 'hm-inbox-main',
                    children: [
                      jsxs('div', {
                        className: 'hm-inbox-line',
                        children: [
                          jsx('span', { className: 'hm-inbox-from', children: i.from || t('inboxUnknown') }),
                          jsx('span', {
                            className: 'hm-inbox-age',
                            children: i.status === 'claimed' ? t('inboxNow', inboxAge(i.claimed_at)) : i.stuck ? t('inboxStuckAge', inboxAge(i.created_at)) : t('inboxAge', inboxAge(i.created_at))
                          })
                        ]
                      }),
                      jsx('div', { className: 'hm-inbox-preview', children: i.preview }),
                      i.stuck && jsx('div', { className: 'hm-inbox-stuck', children: t('inboxStuckHint') }),
                      box.actions && i.status === 'queued' && jsx(InboxActions, { item: i, ask: ask && ask.id === i.id ? ask : null, t })
                    ]
                  })
                ]
              })
            ),
            box.medianWait != null && jsx('div', { className: 'hm-inbox-foot', children: t('inboxMedian', Math.round(box.medianWait)) })
          ]
        })
    ]
  })
}

function InboxActions({ item, ask, t }) {
  const btn = (label, onClick, extra = {}) =>
    jsx('button', { type: 'button', className: 'hm-inbox-btn', disabled: !!ask?.busy, onClick, children: label, ...extra })
  if (ask?.busy) return jsx('div', { className: 'hm-inbox-acts', children: jsx('span', { className: 'hm-inbox-note', children: t('inboxWorking') }) })
  if (ask && !ask.note) {
    return jsxs('div', {
      className: 'hm-inbox-acts',
      role: 'group',
      children: [
        jsx('span', { className: 'hm-inbox-q', children: t(ask.action === 'take' ? 'inboxConfirmTake' : 'inboxConfirmSkip') }),
        btn(t('inboxConfirm'), () => runInboxAction(item, ask.action, t), ask.action === 'take' ? { 'data-primary': '' } : { 'data-danger': '' }),
        btn(t('inboxCancel'), () => $inboxAsk.set(null))
      ]
    })
  }
  return jsxs('div', {
    className: 'hm-inbox-acts',
    children: [
      btn(t('inboxTake'), () => $inboxAsk.set({ id: item.id, action: 'take', key: $inbox.get()?.key }), { 'data-primary': '' }),
      btn(t('inboxSkip'), () => $inboxAsk.set({ id: item.id, action: 'skip', key: $inbox.get()?.key })),
      ask?.note && jsx('span', { className: 'hm-inbox-note', role: 'status', children: ask.note })
    ]
  })
}

// A taken message that did not reach its new chat. Shown only in the Bot Chat
// it came from. If the prompt may already have run, say so and make a resend
// a deliberate second step rather than the default.
function InboxParked({ parked, t }) {
  const btn = (label, onClick, extra = {}) => jsx('button', { type: 'button', className: 'hm-inbox-btn', onClick, children: label, ...extra })
  return jsxs('div', {
    className: 'hm-inbox-parked',
    role: 'status',
    'data-maybe': parked.maybeSent ? '' : undefined,
    children: [
      jsx('span', { className: 'hm-inbox-q', children: t(parked.maybeSent ? 'inboxMaybeSent' : 'inboxParkedNote', parked.title) }),
      btn(t(parked.maybeSent ? 'inboxPlaceAnyway' : 'inboxPlace'), () => placeParked(parked), parked.maybeSent ? {} : { 'data-primary': '' }),
      btn(t('inboxDismiss'), () => $inboxParked.get() === parked && $inboxParked.set(null))
    ]
  })
}

// ─── Bot-to-bot threads (SDK-free: also loaded by the visual test fixture) ──
// A teammate conversation shows as ONE compact row ("Hermes ⇄ Quest · 2
// messages · replied"); a tap opens it as a mini group chat of bubbles.
//
// Outbound (this bot used message_agent): the reply lands later as a
// background-process notice. The row replaces that notice, pairing the reply
// with the message that was sent, read from session.history.
// Inbound (a teammate wrote first): the app's "Message from X" note and the
// folded "Replied to X" answer merge into the same row.

const AT_DM_RE = /bot_mode_dm\.py[\s\S]*?\s-p\s+"?([a-z0-9][a-z0-9_-]{0,63})"?\s+chat\b/i
const AT_NOISE_LINE = /^(↻ Resumed session|Model restored from session|session_id:)/

// Automatic prompts Hermes injects as a "user" turn (e.g. "[System: Your
// previous response contained only internal reasoning…]"). They are not the
// user's words, so they must not look like the user's green bubble.
const SYS_NUDGE = /^\[(System|SYSTEM)\s*:/
const isSysNudge = root => SYS_NUDGE.test((root?.querySelector?.('.composer-human-message')?.textContent || '').trim())

function agentKeyOf(value) {
  return String(value || '').trim().replace(/^@/, '').replace(/@[^@]*$/, '').split('/').pop().toLowerCase()
}

/** A bot_mode_dm completion block → { target, reply, ok } (null if it isn't one). */
function parseDmBlock(block) {
  const m = AT_DM_RE.exec(block)
  if (!m) return null
  const ok = /completed normally|exit code 0\b/.test(block)
  const out = block.indexOf('\nOutput:\n')
  let reply = out === -1 ? '' : block.slice(out + 9).replace(/\]\s*$/, '').trim()
  if (reply.startsWith('{')) {
    try {
      const j = JSON.parse(reply)
      if (typeof j.reply === 'string') reply = j.reply
    } catch {}
  }
  reply = reply.split('\n').filter(l => !AT_NOISE_LINE.test(l.trim())).join('\n').trim()
  return { target: m[1].toLowerCase(), reply, ok }
}

function dmBlocks(text) {
  return String(text || '').split(/\n\n(?=\[IMPORTANT: )/).map(parseDmBlock).filter(Boolean)
}

const isNoticeRow = m =>
  m && (m.display_kind === 'process_complete' || m.display_kind === 'async_delegation_complete' ||
    (!m.display_kind && /^\[IMPORTANT: Background process/.test(String(m.text || ''))))

/** Pair every reply notice with the message_agent call that asked for it. */
function exchangesFromHistory(messages) {
  const notices = []
  const sent = []
  for (const m of messages || []) {
    if (m?.role === 'tool' && m.name === 'message_agent' && m.args) {
      sent.push({ target: agentKeyOf(m.args.target), message: String(m.args.message || ''), used: false })
    } else if (isNoticeRow(m)) {
      const blocks = dmBlocks(m.text)
      const pairs = blocks.map(b => {
        let ask = null
        for (let i = sent.length - 1; i >= 0; i--) {
          if (!sent[i].used && sent[i].target === b.target) {
            ask = sent[i]
            break
          }
        }
        if (ask) ask.used = true
        return { ...b, message: ask?.message || '' }
      })
      notices.push({ label: m.display_metadata?.display_text || '', pairs })
    }
  }
  return notices
}

const escapeHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const lightMarkdown = s =>
  escapeHtml(s)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')

// Bot faces exactly as the sidebar draws them: the profile's ui_meta shape
// ('blobatar[:seed[:kind]]') rendered by the SDK's blobatar. The saved
// avatar.png is only a backfill snapshot and can be stale, so it is used
// only for photo avatars or when the face cannot be drawn.
const BLOB_KIND_TRAIT = { round: 0.11, organic: 0.35, boxy: 0.54, capsule: 0.65, nub: 0.745, cloud: 0.825, droplet: 0.8875, hexagon: 0.9325, sun: 0.965, triangle: 0.99 }
function botFaceSvg(meta, name, size = 44) {
  const blob = typeof HermesSDK === 'object' ? HermesSDK.blobatarSvg : null
  const shape = meta?.shape
  if (typeof blob !== 'function' || meta?.imageKind === 'photo') return null
  if (!(shape === 'blobatar' || (typeof shape === 'string' && shape.startsWith('blobatar:')))) return null
  const [, seedPart = '', kind = ''] = shape.split(':')
  const opts = { size }
  if (BLOB_KIND_TRAIT[kind] != null) opts.traits = { shape: BLOB_KIND_TRAIT[kind] }
  try {
    const svg = blob(seedPart || name || 'agent', opts)
    return typeof svg === 'string' && svg.trim().startsWith('<svg') ? svg : null
  } catch {
    return null
  }
}

function createAgentThreads({ request, sessionId, selfName, label, onDispose, listen }) {
  const open = new Set()
  const profiles = new Map() // key → { name, avatar }
  let profilesLoaded = null
  let history = { sid: null, stamp: '', notices: [] }
  let fetching = null

  // The roster names each bot by its sidebar title (ui_meta), then its
  // display name. A failed or empty answer (e.g. asked before the gateway was
  // ready) is not cached, so the next paint asks again.
  let retryAt = 0
  const loadProfiles = () => {
    if (profilesLoaded || Date.now() < retryAt) return profilesLoaded
    return (profilesLoaded = request('profiles.list', { include_sessions: false })
      .then(async res => {
        const list = res?.profiles || []
        if (!list.length) throw new Error('empty roster')
        for (const p of list) {
          const meta = p.ui_meta?.['hermes-bots']
          const title = meta?.title
          const entry = { name: (typeof title === 'string' && title.trim()) || p.display_name || p.name, avatar: null, face: botFaceSvg(meta, p.name) }
          profiles.set(p.name.toLowerCase(), entry)
          profiles.set(entry.name.toLowerCase(), entry)
          if (p.display_name) profiles.set(p.display_name.toLowerCase(), entry)
          if (p.is_default) profiles.set('hermes', entry)
          if (p.is_default) profiles.set('default', entry)
          if (p.has_avatar && !entry.face) {
            request('profiles.get_asset', { asset: 'avatar', name: p.name })
              .then(a => {
                if (a?.found && a.data) {
                  entry.avatar = a.data
                  redrawInbound()
                }
              })
              .catch(() => {})
          }
        }
        redrawInbound()
      })
      .catch(() => {
        profilesLoaded = null
        retryAt = Date.now() + 5000
      }))
  }

  const who = key => {
    if (!profiles.size) loadProfiles()
    const k = agentKeyOf(key)
    return profiles.get(k) || profiles.get(String(key || '').trim().toLowerCase()) || { name: k || label('teammate'), avatar: null }
  }

  // Inbound threads are drawn once per note; after names or avatars arrive,
  // drop them and let the next paint draw them again.
  function redrawInbound() {
    for (const t of document.querySelectorAll('.hm-at[data-hm-at^="in:"]')) t.remove()
    for (const el of document.querySelectorAll("[data-slot='aui_agent-message-note'][data-hm-hidden]")) el.removeAttribute('data-hm-hidden')
    schedule()
  }

  const avatarEl = (person, self = false) => {
    const a = document.createElement('span')
    a.className = 'hm-at-avatar'
    if (self) a.setAttribute('data-self', '')
    if (person.face) {
      a.setAttribute('data-face', '')
      a.innerHTML = person.face
    } else if (person.avatar) {
      const img = document.createElement('img')
      img.src = person.avatar
      img.alt = ''
      a.append(img)
    } else {
      const glyph = [...person.name].find(c => /\p{Extended_Pictographic}/u.test(c))
      a.textContent = glyph || person.name.trim().charAt(0).toUpperCase() || '🤖'
    }
    return a
  }

  /** messages: [{ from: person, side: 'self'|'peer', html }] */
  function buildThread(key, peer, me, messages, state) {
    const root = document.createElement('div')
    root.className = 'hm-at'
    root.setAttribute('data-hm-at', key)
    root.setAttribute('data-state', state)
    if (open.has(key)) root.setAttribute('data-open', '')

    const head = document.createElement('button')
    head.type = 'button'
    head.className = 'hm-at-head'
    head.setAttribute('aria-expanded', String(open.has(key)))
    const faces = document.createElement('span')
    faces.className = 'hm-at-faces'
    faces.append(avatarEl(me, true), avatarEl(peer))
    const title = document.createElement('span')
    title.className = 'hm-at-title'
    title.textContent = `${me.name} ⇄ ${peer.name}`
    const meta = document.createElement('span')
    meta.className = 'hm-at-meta'
    meta.textContent = [label('messages', messages.length), label(state)].filter(Boolean).join(' · ')
    const chev = document.createElement('span')
    chev.className = 'hm-at-chev'
    chev.setAttribute('aria-hidden', 'true')
    head.append(faces, title, meta, chev)
    head.addEventListener('click', () => {
      const on = !open.has(key)
      on ? open.add(key) : open.delete(key)
      root.toggleAttribute('data-open', on)
      head.setAttribute('aria-expanded', String(on))
    })

    const body = document.createElement('div')
    body.className = 'hm-at-body'
    for (const m of messages) {
      const row = document.createElement('div')
      row.className = 'hm-at-msg'
      row.setAttribute('data-side', m.side)
      const col = document.createElement('div')
      col.className = 'hm-at-col'
      const name = document.createElement('div')
      name.className = 'hm-at-name'
      name.textContent = m.from.name
      const bubble = document.createElement('div')
      bubble.className = 'hm-at-bubble'
      if (m.node) bubble.append(m.node)
      else bubble.innerHTML = m.html
      col.append(name, bubble)
      row.append(avatarEl(m.from, m.side === 'self'), col)
      body.append(row)
    }
    root.append(head, body)
    return root
  }

  const place = (anchor, thread) => {
    const old = anchor.previousElementSibling?.matches?.('.hm-at-group') ? anchor.previousElementSibling : null
    if (old && old.getAttribute('data-hm-at-sig') === thread.getAttribute('data-hm-at-sig')) return
    old?.remove()
    anchor.before(thread)
    anchor.setAttribute('data-hm-hidden', '')
  }

  // Outbound: reply notices, aligned from the end with history's notices.
  function renderOutbound() {
    const rows = [...document.querySelectorAll("[data-slot='aui_background-result']")]
    const notices = history.notices
    if (!rows.length || !notices.length) return
    const me = who(selfName() || 'hermes')
    for (let i = 1; i <= Math.min(rows.length, notices.length); i++) {
      const row = rows[rows.length - i]
      const n = notices[notices.length - i]
      if (!n.pairs.length) continue
      const shown = row.textContent.replace(/\s+/g, ' ').trim()
      if (n.label && !shown.includes(n.label.replace(/\s+/g, ' ').trim().slice(0, 40))) continue
      const group = document.createElement('div')
      group.className = 'hm-at-group'
      n.pairs.forEach((p, j) => {
        const peer = who(p.target)
        const key = `out:${history.sid}:${notices.length - i}:${j}`
        const msgs = []
        if (p.message) msgs.push({ from: me, side: 'self', html: lightMarkdown(p.message) })
        if (p.reply) msgs.push({ from: peer, side: 'peer', html: lightMarkdown(p.reply) })
        group.append(buildThread(key, peer, me, msgs, p.ok ? (p.reply ? 'replied' : 'delivered') : 'failed'))
      })
      group.setAttribute('data-hm-at-sig', `${history.stamp}:${notices.length - i}:${profiles.size}:${[...profiles.values()].filter(p => p.avatar).length}`)
      place(row, group)
    }
  }

  // Inbound: the app's "Message from X" note (+ the folded reply after it).
  function renderInbound() {
    const me = who(selfName() || 'hermes')
    for (const note of document.querySelectorAll("[data-slot='aui_agent-message-note']:not([data-hm-hidden])")) {
      const sender = (note.querySelector('.wrap-anywhere')?.textContent || '').replace(/^Message from\s*/, '').trim()
      const peer = profiles.get(agentKeyOf(sender)) || profiles.get(sender.toLowerCase()) || { name: sender, avatar: null }
      const bodyEl = note.querySelector('details > div')
      const msgs = []
      if (bodyEl) msgs.push({ from: peer, side: 'peer', node: bodyEl.cloneNode(true) })

      // The bot's answer, folded by the app as "Replied to X · show reply".
      // A turn can fold into several "Replied to X" rows (e.g. a reasoning-only
      // step, then the answer): take them all, keep the ones with text.
      const turn = note.closest("[data-slot='aui_user-message-root']")
      const replyNotices = []
      const seenReplies = new Set()
      let replyBody = null
      for (let el = turn?.nextElementSibling, hops = 0; el && hops < 8; el = el.nextElementSibling, hops++) {
        if (el.matches("[data-slot='aui_user-message-root']") && !isSysNudge(el)) break
        for (const d of el.querySelectorAll('details')) {
          if (d.querySelector('summary')?.textContent.trim() !== 'show reply') continue
          replyNotices.push(d.parentElement)
          const b = d.querySelector(':scope > div')
          const txt = (b?.textContent || '').replace(/\s+/g, ' ').trim()
          if (b && txt && !seenReplies.has(txt)) {
            seenReplies.add(txt)
            msgs.push({ from: me, side: 'self', node: b.cloneNode(true) })
            replyBody = b
          }
        }
      }
      for (const m of msgs.slice(1)) if (m.side === 'self') hideEchoes(turn, m.node)

      const idx = [...document.querySelectorAll("[data-slot='aui_agent-message-note']")].indexOf(note)
      const thread = buildThread(`in:${sessionId() || ''}:${idx}`, peer, me, msgs, replyBody || replyNotices.length ? 'replied' : 'received')
      thread.setAttribute('data-hm-at-sig', `${msgs.length}:${peer.avatar || peer.face ? 1 : 0}`)
      note.before(thread)
      note.setAttribute('data-hm-hidden', '')
      for (const rn of replyNotices) {
        rn.setAttribute('data-hm-hidden', '')
        rn.setAttribute('data-hm-at-merged', '')
      }
    }
  }

  // The same reply can also be painted as ordinary bubbles right after the
  // folded notice (the app folds only the first assistant row of a turn).
  // Hide a following bubble only when its whole text is already inside the
  // thread's reply, and stop at the next user turn.
  const norm = t => (t || '').replace(/\s+/g, ' ').trim()
  function hideEchoes(turn, replyBody) {
    const reply = norm(replyBody.textContent)
    if (!reply) return
    let el = turn?.nextElementSibling
    for (let hops = 0; el && hops < 8; el = el.nextElementSibling, hops++) {
      if (el.matches("[data-slot='aui_user-message-root']") && !isSysNudge(el)) break
      const rows = el.matches("[data-slot='aui_assistant-message-root']") ? [el] : [...el.querySelectorAll("[data-slot='aui_assistant-message-root']")]
      for (const row of rows) {
        const body = row.querySelector("[data-slot='aui_assistant-message-content']")
        const text = norm(body?.textContent)
        if (text.length > 20 && reply.includes(text)) {
          body.setAttribute('data-hm-hidden', '')
          body.setAttribute('data-hm-at-merged', '')
        }
      }
    }
  }

  // Inbound threads are rebuilt when the app re-renders the note (the hidden
  // attribute disappears with it); stale ones are dropped here.
  const sweep = () => {
    for (const t of document.querySelectorAll('.hm-at[data-hm-at^="in:"]')) {
      const next = t.nextElementSibling
      if (!next?.matches?.("[data-slot='aui_agent-message-note'][data-hm-hidden]")) t.remove()
    }
    for (const g of document.querySelectorAll('.hm-at-group')) {
      if (!g.nextElementSibling?.matches?.("[data-slot='aui_background-result']")) g.remove()
    }
  }

  const stampOf = () =>
    `${document.querySelectorAll("[data-slot='aui_background-result']").length}`

  async function refreshHistory() {
    const sid = sessionId()
    const stamp = `${sid}:${stampOf()}`
    if (!sid || (history.sid === sid && history.stamp === stamp) || fetching) return
    fetching = request('session.history', { session_id: sid })
      .then(res => {
        history = { sid, stamp, notices: exchangesFromHistory(res?.messages) }
      })
      .catch(() => {
        history = { sid, stamp, notices: [] }
      })
      .finally(() => {
        fetching = null
        schedule()
      })
  }

  const render = () => {
    sweep()
    renderInbound()
    if (document.querySelector("[data-slot='aui_background-result']")) {
      refreshHistory()
      renderOutbound()
    }
  }

  let frame = 0
  let timer = 0
  function schedule() {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      clearTimeout(timer)
      timer = setTimeout(render, 120)
    })
  }

  const observer = new MutationObserver(records => {
    for (const r of records) {
      const t = r.target
      if (t?.closest?.('.hm-at, .hm-at-group')) continue
      schedule()
      return
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
  for (const l of listen || []) onDispose(l(() => {
    history = { sid: null, stamp: '', notices: [] }
    schedule()
  }))
  loadProfiles()
  schedule()

  onDispose(() => {
    observer.disconnect()
    cancelAnimationFrame(frame)
    clearTimeout(timer)
    for (const el of document.querySelectorAll('.hm-at, .hm-at-group')) el.remove()
    for (const el of document.querySelectorAll("[data-slot='aui_agent-message-note'][data-hm-hidden], [data-slot='aui_background-result'][data-hm-hidden], [data-hm-at-merged]")) {
      el.removeAttribute('data-hm-hidden')
      el.removeAttribute('data-hm-at-merged')
    }
  })
}
// ─── end bot-to-bot threads ─────────────────────────────────────────────────

// ─── System cards: cron reports & kanban alerts (SDK-free, fixture-tested) ──
// Both arrive as USER turns, so the app paints them as your own green bubble,
// with the model-facing "[Cronjob … output — scheduled job, not the user …]"
// header and raw **markdown** showing. Here they become left-aligned system
// cards: a named header, rendered text, and a fold for long reports.

const CRON_RE = /^\s*\[Cronjob "([^"]*)" output — [^\]]*\]\s*/
const KANBAN_RE = /^\s*(\S{1,3})\s+\[([^\]]+)\]\s+(?:@(\S+)\s+)?Kanban\s+(t_[0-9a-f]+)\s*(?:—\s*)?([\s\S]*)$/u
const KANBAN_STATE = { '⏸': 'blocked', '✔': 'done', '✅': 'done', '⏱': 'timeout', '✖': 'crashed', '🛑': 'changes', '🔄': 'status', '👀': 'review', '⚠': 'warn', '⚠️': 'warn' }

function richText(s) {
  const inline = t =>
    escapeHtml(t)
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, txt, url) => `<a href="${url}" data-hm-ext>${txt}</a>`)
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, pre, url) => `${pre}<a href="${url}" data-hm-ext>${url.replace(/^https?:\/\//, '').slice(0, 48)}${url.length > 56 ? '…' : ''}</a>`)
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
  return String(s).trim().split(/\n{2,}/).map(block => {
    const lines = block.split('\n')
    if (lines.every(l => /^\s*[-*•]\s+/.test(l))) return `<ul>${lines.map(l => `<li>${inline(l.replace(/^\s*[-*•]\s+/, ''))}</li>`).join('')}</ul>`
    return `<p>${lines.map(inline).join('<br>')}</p>`
  }).join('')
}

function classifySystemText(text) {
  const cron = CRON_RE.exec(text)
  if (cron) return { kind: 'cron', name: cron[1], body: text.slice(cron[0].length) }
  const kb = KANBAN_RE.exec(text)
  if (kb && KANBAN_STATE[kb[1]]) {
    const body = kb[5].trim().replace(/^(blocked|done|timed out|review requested changes\/BLOCK)\s*[:—]?\s*/i, '')
    return { kind: 'kanban', state: KANBAN_STATE[kb[1]], glyph: kb[1], board: kb[2], bot: kb[3] || '', task: kb[4], body }
  }
  return null
}

function createSystemCards({ label, openLink, onDispose }) {
  const open = new Set()

  function card(info, key) {
    const el = document.createElement('div')
    el.className = 'hm-sys'
    el.setAttribute('data-kind', info.kind)
    if (info.state) el.setAttribute('data-state', info.state)
    const head = document.createElement('div')
    head.className = 'hm-sys-head'
    const icon = document.createElement('span')
    icon.className = 'hm-sys-icon'
    const title = document.createElement('span')
    title.className = 'hm-sys-title'
    const meta = document.createElement('span')
    meta.className = 'hm-sys-meta'
    if (info.kind === 'cron') {
      icon.textContent = '⏱'
      title.textContent = info.name
      meta.textContent = label('scheduledJob')
    } else {
      icon.textContent = info.glyph
      title.textContent = `${label('kb_' + info.state)} · ${info.task}`
      meta.textContent = [info.board, info.bot && '@' + info.bot].filter(Boolean).join(' · ')
    }
    head.append(icon, title, meta)
    el.append(head)
    if (info.body) {
      const body = document.createElement('div')
      body.className = 'hm-sys-body'
      body.innerHTML = richText(info.body)
      el.append(body)
      const long = info.body.length > (info.kind === 'cron' ? 420 : 160)
      if (long) {
        el.setAttribute('data-long', '')
        if (open.has(key)) el.setAttribute('data-open', '')
        const more = document.createElement('button')
        more.type = 'button'
        more.className = 'hm-sys-more'
        const sync = () => (more.textContent = label(el.hasAttribute('data-open') ? 'showLess' : 'showMore'))
        sync()
        more.addEventListener('click', () => {
          const on = !el.hasAttribute('data-open')
          el.toggleAttribute('data-open', on)
          on ? open.add(key) : open.delete(key)
          sync()
        })
        el.append(more)
      }
    }
    return el
  }

  const textOf = root => {
    const b = root.querySelector('.composer-human-message')
    if (!b) return ''
    const clone = b.cloneNode(true)
    for (const x of clone.querySelectorAll('button, .hm-quote, .hm-att')) x.remove()
    return clone.innerText || clone.textContent || ''
  }

  const scan = () => {
    const roots = document.querySelectorAll("[data-slot='aui_user-message-root']")
    roots.forEach((root, i) => {
      const text = textOf(root)
      const sig = text.slice(0, 200)
      if (root.getAttribute('data-hm-sys') === sig && root.querySelector(':scope > .hm-sys')) return
      root.querySelector(':scope > .hm-sys')?.remove()
      const info = text && classifySystemText(text)
      if (!info) {
        root.removeAttribute('data-hm-sys')
        return
      }
      root.setAttribute('data-hm-sys', sig)
      root.prepend(card(info, `${i}:${sig.slice(0, 60)}`))
    })
  }

  const onClick = e => {
    const a = e.target.closest?.('.hm-sys a[data-hm-ext]')
    if (!a) return
    e.preventDefault()
    openLink(a.getAttribute('href'))
  }
  document.addEventListener('click', onClick, true)

  let frame = 0
  const observer = new MutationObserver(records => {
    if (records.every(r => r.target?.closest?.('.hm-sys'))) return
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(scan)
  })
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  scan()
  onDispose(() => {
    observer.disconnect()
    cancelAnimationFrame(frame)
    document.removeEventListener('click', onClick, true)
    for (const el of document.querySelectorAll('.hm-sys')) el.remove()
    for (const el of document.querySelectorAll('[data-hm-sys]')) el.removeAttribute('data-hm-sys')
  })
}
// ─── end system cards ───────────────────────────────────────────────────────

// ─── Attention: which bot replies need the user ──────────────────────────────
// Bot replies are sorted into three kinds by what they SAY, never guessed from
// length alone:
//   needs  — asks the user to decide/approve/answer, or carries a question or
//            approval card. Never folded; gets a "Needs you" badge.
//   fyi    — says outright that nothing is needed ("no action needed",
//            "that alert is stale", "already handled"), is a one-line "I'll
//            check…" narration, or repeats a reply shown just above.
//            Folded to one line in Calm, hidden in Results (⌥ to peek).
//   normal — everything else, untouched.
// "All" shows every reply exactly as the app draws it.

const ATTN_NEEDS = [
  /(?<![“"'‘]|\bwhat |\bits )\b(needs?|requires?|waiting (on|for)) (your|you|owner|the owner)\b(?![”"'’])/i,
  /\byour (approval|decision|confirmation|answer|input|go-ahead|sign-?off|choice)\b/i,
  /\b(please|could you|can you|would you|do you want|shall i|should i|want me to)\b[^.?!]{0,120}\?/i,
  /\b(please )(approve|confirm|choose|pick|decide|reply|answer|review|sign in|log in|restore)\b/i,
  /\b(action required|decision needed|owner decision|owner action)\b(?!\s*(is\s*)?(needed|required)?\s*[:.]?\s*(none|no)\b)/i,
  /\bwhich (one|option)\b[^.?!]{0,80}\?/i
]
const ATTN_FYI = [
  /\bno (further )?(action|decision|input|reply)s? (is |are )?(needed|required|necessary)\b/i,
  /\bno (owner|user) (action|decision|input)\b/i,
  /\bnothing (here |else )?(is )?(needed|required|needs you|for you to do)\b/i,
  /\bnothing (here )?needs (you|your)\b/i,
  /\bnothing needs you\b/i,
  /\bnothing (for you )?to act on\b/i,
  /\b(duplicate|repeated) (reminder|alert|notice|notification)\b/i,
  /\balready[- ]handled (alert|notice|warning)\b/i,
  /\b(this|that|the) (alert|notice|notification|report|message) (is|was) (stale|outdated|superseded|a delayed|already handled|old)\b/i,
  /\b(was|is) a (delayed|late|stale|duplicate)\b[^.]{0,40}\b(notice|alert|notification|report)\b/i,
  /\balready (resumed|handled|done|resolved|fixed|recovered|picked up|moved on)\b/i,
  /\b(you can|safe to) ignore (it|this|that)\b/i,
  /\bno (new )?(change|changes|news|update|updates)\b[^.]{0,30}\.?$/i
]
const NARRATION = /^(i['’]ll|i will|let me|checking|looking|now (checking|looking))\b/i

function classifyAttention(text, hasCard) {
  if (hasCard) return 'needs'
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return null
  if (ATTN_NEEDS.some(r => r.test(t))) {
    // "No action needed from you" contains "from you"; only an explicit ask
    // outranks an explicit all-clear.
    if (!ATTN_FYI.some(r => r.test(t))) return 'needs'
    if (/\?\s*$/.test(t) || /\byour (approval|decision|confirmation)\b/i.test(t)) return 'needs'
    return 'fyi'
  }
  if (ATTN_FYI.some(r => r.test(t))) return 'fyi'
  if (NARRATION.test(t) && t.length < 240 && !/\?/.test(t)) return 'fyi'
  return null
}

function createAttention({ label, onDispose }) {
  const open = new Set()
  const ROOT_SEL = "[data-slot='aui_assistant-message-root']"
  const textOf = root => {
    const c = root.querySelector("[data-slot='aui_assistant-message-content']")
    if (!c) return ''
    const md = [...c.querySelectorAll(':scope > .aui-md:not([data-slot="aui_reasoning-text"])')]
    return (md.length ? md.map(m => m.innerText || m.textContent).join('\n') : '').trim()
  }
  const firstLine = t => t.replace(/\s+/g, ' ').trim().slice(0, 160)

  function badge(root, kind, text, repeat, key) {
    let el = root.querySelector(':scope > .hm-attn')
    if (!kind) return el?.remove()
    if (el && el.getAttribute('data-kind') === kind && el.getAttribute('data-sig') === key) return
    el?.remove()
    if (kind === 'needs') {
      el = document.createElement('div')
      el.textContent = '● ' + label('attnNeeds')
    } else {
      el = document.createElement('button')
      el.type = 'button'
      el.title = label('attnShow')
      const tag = document.createElement('span')
      tag.className = 'hm-attn-tag'
      tag.textContent = (repeat ? '↻ ' + label('attnRepeat') : '✓ ' + label('attnFyi')) + ' ·'
      const body = document.createElement('span')
      body.className = 'hm-attn-text'
      body.textContent = firstLine(text)
      el.append(tag, body)
      el.addEventListener('click', () => {
        const on = !root.hasAttribute('data-hm-open')
        root.toggleAttribute('data-hm-open', on)
        on ? open.add(key) : open.delete(key)
        el.setAttribute('aria-expanded', String(on))
      })
      el.setAttribute('aria-expanded', String(open.has(key)))
    }
    el.className = 'hm-attn'
    el.setAttribute('data-kind', kind)
    el.setAttribute('data-sig', key)
    root.prepend(el)
  }

  function markNudges() {
    for (const u of document.querySelectorAll("[data-slot='aui_user-message-root']")) {
      const sys = isSysNudge(u)
      let pill = u.querySelector(':scope > .hm-nudge')
      if (!sys) {
        if (u.hasAttribute('data-hm-nudge')) u.removeAttribute('data-hm-nudge')
        pill?.remove()
        continue
      }
      if (!u.hasAttribute('data-hm-nudge')) u.setAttribute('data-hm-nudge', '')
      if (pill) continue
      const raw = (u.querySelector('.composer-human-message')?.textContent || '').trim()
      const text = raw.replace(SYS_NUDGE, '').replace(/\]\s*$/, '').trim()
      pill = document.createElement('button')
      pill.type = 'button'
      pill.className = 'hm-nudge'
      pill.title = label('attnShow')
      pill.setAttribute('aria-expanded', 'false')
      const tag = document.createElement('span')
      tag.className = 'hm-attn-tag'
      tag.textContent = '⚙ ' + label('sysNudge') + ' ·'
      const body = document.createElement('span')
      body.className = 'hm-attn-text'
      body.textContent = text
      pill.append(tag, body)
      pill.addEventListener('click', () => {
        const on = !u.hasAttribute('data-hm-open')
        u.toggleAttribute('data-hm-open', on)
        pill.setAttribute('aria-expanded', String(on))
      })
      u.prepend(pill)
    }
  }

  const scan = () => {
    markNudges()
    const roots = [...document.querySelectorAll(ROOT_SEL)]
    const seen = []
    const last = roots[roots.length - 1]
    for (const root of roots) {
      const text = textOf(root)
      const norm = text.replace(/\s+/g, ' ').trim()
      const hasCard = !!root.querySelector(ACTIONABLE)
      // The newest reply may still be streaming: leave it alone until it has
      // settled (the app marks a running turn with data-hm-busy on <html>).
      const settling = root === last && ROOT.hasAttribute('data-hm-busy')
      let kind = settling && !hasCard ? null : classifyAttention(text, hasCard)
      const repeat = !hasCard && norm.length > 40 && seen.slice(-12).includes(norm)
      if (repeat && kind !== 'needs') kind = 'fyi'
      if (norm) seen.push(norm)
      const key = norm.slice(0, 120)
      if (kind) root.setAttribute('data-hm-attn', kind)
      else root.removeAttribute('data-hm-attn')
      if (kind === 'fyi' && open.has(key)) root.setAttribute('data-hm-open', '')
      else if (kind !== 'fyi') root.removeAttribute('data-hm-open')
      badge(root, kind, text, repeat && !classifyAttention(text, hasCard), key)
    }
  }

  let frame = 0
  const observer = new MutationObserver(records => {
    if (records.every(r => r.target?.closest?.('.hm-attn, .hm-nudge'))) return
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(scan)
  })
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  const rootObs = new MutationObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(scan) })
  rootObs.observe(ROOT, { attributes: true, attributeFilter: ['data-hm-busy'] })
  scan()
  onDispose(() => {
    observer.disconnect()
    rootObs.disconnect()
    cancelAnimationFrame(frame)
    for (const el of document.querySelectorAll('.hm-attn, .hm-nudge')) el.remove()
    for (const el of document.querySelectorAll('[data-hm-nudge]')) el.removeAttribute('data-hm-nudge')
    for (const el of document.querySelectorAll('[data-hm-attn]')) el.removeAttribute('data-hm-attn')
    for (const el of document.querySelectorAll('[data-hm-open]')) el.removeAttribute('data-hm-open')
  })
}
// ─── end attention ──────────────────────────────────────────────────────────

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

    // Live inbox: what is still waiting for this bot's Bot Chat.
    if (typeof ctx.rest === 'function') {
      startInboxPoller({
        rest: (path, opts) => ctx.rest(path, opts),
        sessionId: () => host.state.focusedStoredSessionId?.get?.() || null,
        owner: () => host.state.focusedSessionOwner?.get?.() || { profile: host.state.focusedSessionProfile?.get?.() || 'default' },
        watch: [host.state.focusedStoredSessionId, host.state.focusedSessionOwner, host.state.focusedSessionProfile].filter(a => a?.listen).map(a => fn => a.listen(fn)),
        onDispose: fn => ctx.onDispose(fn)
      })
      ctx.register({ id: 'inbox-strip', area: COMPOSER_AREAS.top, render: () => jsx(InboxStrip, {}) })
    }

    // Cron reports and kanban alerts: system cards, not your own green bubble.
    createSystemCards({
      label: key => t(key),
      openLink: url => (window.hermesDesktop?.openExternal ? window.hermesDesktop.openExternal(url) : window.open(url, '_blank')),
      onDispose: fn => ctx.onDispose(fn)
    })

    // Replies that need you get a badge; "no action needed" folds to one line.
    createAttention({ label: key => t(key), onDispose: fn => ctx.onDispose(fn) })

    // Bot-to-bot conversations: one compact row that opens into bubbles.
    createAgentThreads({
      request: (method, params) => host.request(method, params),
      sessionId: () => host.state.focusedSessionId?.get?.() || host.state.activeSessionId?.get?.() || null,
      selfName: () => host.state.focusedSessionProfile?.get?.() || host.state.profile?.get?.() || 'hermes',
      label: (key, ...args) => t(key, ...args),
      listen: [host.state.focusedSessionId, host.state.activeSessionId].filter(a => a?.listen).map(a => fn => a.listen(fn)),
      onDispose: fn => ctx.onDispose(fn)
    })
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
