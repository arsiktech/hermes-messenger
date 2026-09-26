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

@media (prefers-reduced-motion: reduce) {
  html[data-hm] *, html[data-hm] *::before { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; }
}
html[data-hm-motion='off'] :is(${BUBBLES}, [data-slot='aui_turn-activity'], [data-slot='aui_response-loading']) {
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
    toast: level => `Showing: ${level}`
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
    toast: level => `Показываю: ${level}`
  }
}

// ─── State ──────────────────────────────────────────────────────────────────

let $settings = atom({ ...DEFAULTS })
let save = () => {}

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
