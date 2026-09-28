// Layout regression: Hermes Desktop's clarify-tool.tsx DOM contract, real
// Desktop stylesheet and actual plugin stylesheet. Synthetic content only.
// This verifies rendering/typing/scrolling, NOT live clarify RPC submission.
// Run: HERMES_SOURCE=/path/to/hermes-agent HERMES_ASSETS=/path/to/dist/assets
//      node tests/clarify-layout.mjs [plugin.js] [evidence-dir]
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
const require = createRequire(process.env.HERMES_SOURCE ? join(process.env.HERMES_SOURCE, 'package.json') : import.meta.url)
const { chromium } = require('playwright')
const source = readFileSync(resolve(process.argv[2] || 'desktop/plugin.js'), 'utf8')
const out = resolve(process.argv[3] || '.test-output/clarify')
mkdirSync(out, { recursive: true })
const assets = process.env.HERMES_ASSETS
if (!assets) throw new Error('Set HERMES_ASSETS to the Desktop dist/assets directory')
const cssFile = readdirSync(assets).filter(f => /^index-.*\.css$/.test(f)).sort().at(-1)
if (!cssFile) throw new Error('Desktop index CSS not found')
const appCss = readFileSync(join(assets, cssFile), 'utf8')
const constants = source.slice(source.indexOf('const USER_BUBBLE'), source.indexOf('// ─── Stylesheet'))
const start = source.indexOf('const CSS = /* css */ `')
const end = source.indexOf('\n`\n', start)
if (start < 0 || end < 0) throw new Error('Plugin CSS export boundary not found')
const css = new Function(`${constants}; return ${source.slice(start + 'const CSS = /* css */ '.length, end + 2)}`)()
const optionClass = 'flex w-full items-start gap-2 rounded-[0.25rem] px-1.5 py-1 text-left disabled:cursor-not-allowed disabled:opacity-50'
const areaClass = 'desktop-input-chrome w-full min-w-0 rounded-[2.5px] border text-xs leading-4 text-foreground outline-none placeholder:text-muted-foreground px-2 py-1 field-sizing-content max-h-40 min-h-0 resize-none'
const key = x => `<kbd data-slot="kbd" class="mt-px inline-flex shrink-0 items-center justify-center border font-normal leading-none select-none rounded-[0.2rem] text-[0.625rem] size-[1.125rem] px-0">${x}</kbd>`
const question = n => `<div class="grid gap-1" data-clarify-batch-question="q${n}">
<div class="flex items-start gap-2"><span class="flex-1 whitespace-pre-wrap font-medium">${n}. Which option should be used for this synthetic example?</span></div>
<div class="grid gap-px" role="group" aria-label="Question ${n}">
<button class="${optionClass}" type="button" aria-pressed="false">${key('A')}<span class="flex-1 wrap-anywhere">Keep the existing setting <span>(Recommended)</span></span></button>
<button class="${optionClass}" type="button" aria-pressed="false">${key('B')}<span class="flex-1 wrap-anywhere">Use a different setting</span></button>
<label class="${optionClass} items-center">${key('C')}<textarea aria-label="Answer ${n}" data-slot="textarea" class="${areaClass}" rows="1" placeholder="Other (type your answer)"></textarea></label>
</div></div>`
const pageHtml = dark => `<!doctype html><html class="${dark ? 'dark' : 'light'}" data-hm data-hm-style="bubbles" data-hm-motion="off" data-hm-noise="results"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${appCss}</style><style>${css}</style><style>
:root{--hm-col:800px;--hm-r:1rem;--hm-tail:.375rem;--hm-in-stroke:#8885;--hm-in-bg:${dark ? '#292b30' : '#eceeed'};--ui-base:${dark ? '#fff' : '#000'};--ui-accent:#397c57;--ui-bg-primary:${dark ? '#202125' : '#fff'};--ui-text-primary:${dark ? '#f4f4f4' : '#151515'};--ui-text-secondary:${dark ? '#c9c9c9' : '#444'};--ui-text-tertiary:${dark ? '#aaa' : '#555'};--hm-out-bg:#326746;--hm-out-ink:#fff;--foreground:var(--ui-text-primary);--ui-widget-surface-background:var(--hm-in-bg);--conversation-text-font-size:15px}
body{margin:0;font:15px/1.5 system-ui;background:${dark ? '#18191c' : '#f7f7f4'};color:var(--ui-text-primary)}
main{height:100dvh;overflow-y:auto;padding:24px 20px 100px;box-sizing:border-box}
[data-slot=aui_thread-content]{width:100%;display:flex;flex-direction:column;min-width:0}
[data-slot=aui_assistant-message-root]{min-width:0;width:100%}
[data-slot=aui_assistant-message-content]{display:flex;flex-direction:column;align-items:start;min-width:0}
</style></head><body><main><div data-slot="aui_thread-content"><div data-slot="aui_assistant-message-root"><div data-slot="aui_assistant-message-content">
<form class="my-1.5 grid gap-4" data-clarify-batch="4"><div data-slot="clarify-inline" class="rounded-3xl bg-(--ui-widget-surface-background) px-3.5 py-3 grid gap-3"><div class="flex items-start gap-2"><span class="flex-1 text-[0.6875rem]">Choose or type an answer for each question</span></div>${[1,2,3,4].map(question).join('')}</div><div class="flex items-center justify-end gap-1"><button data-slot="button" type="button">Skip</button><button data-slot="button" type="submit">Confirm and continue</button></div></form>
</div></div></div></main></body></html>`
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true })
const results = []
try {
  for (const width of [360, 390, 1024]) for (const dark of [false, true]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 500, hasTouch: width < 500, deviceScaleFactor: 1 })
    const p = await context.newPage()
    const errors = []; p.on('pageerror', e => errors.push(String(e)))
    await p.setContent(pageHtml(dark))
    // Don't contact a service. The document is a layout fixture only.
    await p.evaluate(() => document.querySelector('form').addEventListener('submit', e => e.preventDefault()))
    const area = p.getByRole('textbox', { name: 'Answer 2', exact: true })
    const values = [
      'A short answer.',
      'A longer answer with a source link: https://example.invalid/spreadsheets/d/' + 'abcdef0123456789'.repeat(16) + '/edit?tab=example End of answer.',
      'W'.repeat(4096),
      Array.from({ length: 80 }, (_, i) => `Line ${i}: Synthetic content for wrapping and internal scrolling.`).join('\n')
    ]
    for (const [index, value] of values.entries()) {
      await area.fill(value)
      const r = await p.evaluate(() => {
        const card = document.querySelector('[data-slot=clarify-inline]'), cr = card.getBoundingClientRect()
        const rows = [...card.querySelectorAll('[role=group] > *, textarea')]
        const bad = rows.filter(e => { const r = e.getBoundingClientRect(); return r.right > cr.right + 1 || r.left < cr.left - 1 }).map(e => ({ tag: e.tagName, width: e.getBoundingClientRect().width }))
        const a = card.querySelector('[aria-label="Answer 2"]')
        return { overflow: bad, cardWidth: cr.width, pageWidth: document.documentElement.scrollWidth, viewport: innerWidth, value: a.value, height: a.getBoundingClientRect().height, scrollWidth: a.scrollWidth, clientWidth: a.clientWidth, scrollHeight: a.scrollHeight, clientHeight: a.clientHeight }
      })
      const ok = !r.overflow.length && r.pageWidth <= r.viewport + 1 && r.value === value && r.scrollWidth <= r.clientWidth + 1 && r.height <= 161
      results.push({ width, dark, case: index, ok, ...r, value: undefined })
      console.log(`${ok ? 'PASS' : 'FAIL'} ${width} ${dark ? 'dark' : 'light'} case ${index}: ${JSON.stringify({ overflow: r.overflow, height: r.height, cardWidth: r.cardWidth, pageWidth: r.pageWidth })}`)
      if (index === 1) await p.screenshot({ path: join(out, `${width}-${dark ? 'dark' : 'light'}.png`) })
    }
    // A long answer must remain scrollable/editable; final controls reachable.
    await area.press('ControlOrMeta+End')
    await area.press('End'); await area.press('!')
    const full = await area.inputValue()
    const scrollable = await area.evaluate(e => e.scrollHeight > e.clientHeight && e.scrollTop > 0)
    await p.getByRole('button', { name: 'Confirm and continue' }).scrollIntoViewIfNeeded()
    const clickable = await p.getByRole('button', { name: 'Confirm and continue' }).evaluate(e => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === e })
    const ok = full.endsWith('!') && scrollable && clickable && !errors.length
    results.push({ width, dark, case: 'edit-scroll-controls', ok, errors })
    console.log(`${ok ? 'PASS' : 'FAIL'} ${width} ${dark ? 'dark' : 'light'} edit-scroll-controls`)
    // Exercise both free-text variants too: batch question without choices,
    // and the single-question field directly in the shell.
    for (const variant of ['batch-free', 'single-free']) {
      await p.evaluate(v => {
        const card = document.querySelector('[data-slot="clarify-inline"]')
        const field = card.querySelector('textarea').cloneNode()
        field.setAttribute('aria-label', 'Free answer')
        card.replaceChildren()
        if (v === 'batch-free') {
          const block = document.createElement('div')
          block.className = 'grid gap-1'
          block.setAttribute('data-clarify-batch-question', 'free')
          block.append(field); card.append(block)
        } else card.append(field)
      }, variant)
      await p.getByRole('textbox', { name: 'Free answer' }).fill('W'.repeat(4096))
      const ok = await p.getByRole('textbox', { name: 'Free answer' }).evaluate(e => {
        const r = e.getBoundingClientRect(), c = e.closest('[data-slot="clarify-inline"]').getBoundingClientRect()
        return r.width > c.width / 2 && r.right <= c.right && e.scrollWidth <= e.clientWidth + 1 && e.value.length === 4096
      })
      results.push({ width, dark, case: variant, ok })
      console.log(`${ok ? 'PASS' : 'FAIL'} ${width} ${dark ? 'dark' : 'light'} ${variant}`)
    }
    await context.close()
  }
} finally { await browser.close() }
writeFileSync(join(out, 'results.json'), JSON.stringify({ appCss: cssFile, results }, null, 2))
const failed = results.filter(x => !x.ok)
console.log(`${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exitCode = 1
