// Synthetic regression for visibility-dependent duplicate classification.
// Real plugin code/CSS; no chat history, queue, network or credentials.
// HERMES_SOURCE=/path/to/hermes-agent node tests/attention-stability.mjs [plugin.js] [out-dir]
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
const require = createRequire(process.env.HERMES_SOURCE ? join(process.env.HERMES_SOURCE, 'package.json') : import.meta.url)
const { chromium } = require('playwright')
const source = readFileSync(resolve(process.argv[2] || 'desktop/plugin.js'), 'utf8')
const out = resolve(process.argv[3] || '.test-output/attention-stability')
mkdirSync(out, { recursive: true })
const constants = source.slice(source.indexOf('const USER_BUBBLE'), source.indexOf('// ─── Stylesheet'))
const start = source.indexOf('const CSS = /* css */ `'), end = source.indexOf('\n`\n', start)
const css = new Function(`${constants}; return ${source.slice(start + 'const CSS = /* css */ '.length, end + 2)}`)()
const attention = source.slice(source.indexOf('const ATTN_NEEDS'), source.indexOf('// ─── end attention'))
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true })
const results = []
const examples = {
  paragraphs: '<p>The synthetic report for <code>release-2.1</code> is available for inspection. The previous checks completed successfully.</p><p>This second paragraph contains additional context for the reader.</p>',
  list: '<p>Synthetic status summary for the component:</p><ul><li>First item with <strong>bold text</strong>.</li><li>Second item with more details.</li></ul>',
  linebreaks: '<p>A long synthetic status line which is repeated exactly.<br>Another line with supporting information.</p>'
}
const root = (id, html) => `<div id="${id}" data-slot="aui_assistant-message-root"><div data-slot="aui_assistant-message-content"><div class="aui-md">${html}</div></div></div>`
try {
  for (const mode of ['all', 'calm', 'results']) for (const [example, html] of Object.entries(examples)) {
    const page = await browser.newPage({ viewport: { width: 900, height: 800 } })
    const errors = []; page.on('pageerror', e => errors.push(String(e)))
    await page.setContent(`<!doctype html><html data-hm data-hm-style="bubbles" data-hm-noise="${mode}" data-hm-motion="off"><head><style>${css}</style><style>
body{font:16px/1.5 system-ui;padding:32px;--ui-base:#000;--ui-text-primary:#222;--ui-text-secondary:#555;--ui-text-tertiary:#777;--hm-in-bg:#eee;--hm-in-stroke:#ddd;--hm-r:16px;--hm-tail:6px} [data-slot=aui_assistant-message-root]{margin-bottom:20px} p{margin:0 0 14px} .aui-md{padding:12px}
</style></head><body>${root('first',html)}${root('duplicate',html)}${root('following','<p>A later, unrelated reply must not jump up and down.</p>')}</body></html>`)
    await page.addScriptTag({ content: `const ROOT=document.documentElement;${constants};${attention};window.__dispose=[];createAttention({label:k=>k,onDispose:f=>window.__dispose.push(f)})` })
    // Sample geometry and classification each frame after initial settling.
    const samples = await page.evaluate(async () => {
      const states=[]
      for(let i=0;i<60;i++) {
        await new Promise(requestAnimationFrame)
        const dup=document.getElementById('duplicate')
        states.push({kind:dup.getAttribute('data-hm-attn'),y:document.getElementById('following').getBoundingClientRect().top,badges:dup.querySelectorAll('.hm-attn').length})
      }
      return states.slice(4)
    })
    const kinds = [...new Set(samples.map(s=>s.kind))]
    const positions = [...new Set(samples.map(s=>s.y))]
    const stable = kinds.length===1 && kinds[0]==='fyi' && positions.length===1 && samples.every(s=>s.badges===1) && !errors.length
    results.push({mode,example,stable,kinds,positions,errors})
    console.log(`${stable?'PASS':'FAIL'} ${mode}/${example}: ${JSON.stringify({kinds,positions})}`)
    if (example==='paragraphs') await page.screenshot({path:join(out,`${mode}.png`)})
    if (mode==='calm' && stable) {
      await page.locator('#duplicate > .hm-attn').click()
      const open = await page.evaluate(() => document.getElementById('duplicate').hasAttribute('data-hm-open') && document.querySelector('#duplicate [data-slot="aui_assistant-message-content"]').getClientRects().length>0)
      results.push({mode,example:'expand',stable:open}); console.log(`${open?'PASS':'FAIL'} expand duplicate`)
      await page.locator('#duplicate > .hm-attn').click()
    }
    await page.evaluate(() => window.__dispose.forEach(f=>f()))
    const restored = await page.locator('#duplicate').evaluate(e => !e.hasAttribute('data-hm-attn') && !e.querySelector('.hm-attn') && e.getClientRects().length>0)
    results.push({mode,example:`${example}/dispose`,stable:restored})
    await page.close()
  }
} finally {await browser.close()}
writeFileSync(join(out,'results.json'),JSON.stringify(results,null,2))
const failed=results.filter(r=>!r.stable)
console.log(`${results.length-failed.length}/${results.length} passed`)
if(failed.length) process.exitCode=1
