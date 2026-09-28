// Approval-card presentation regression. DOM contract from Hermes Desktop's
// tool/approval.tsx; actual app/plugin CSS. All commands and handlers synthetic.
// This never executes a command or changes an approval policy.
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {join,resolve} from 'node:path'
const require=createRequire(process.env.HERMES_SOURCE?join(process.env.HERMES_SOURCE,'package.json'):import.meta.url)
const {chromium}=require('playwright')
const src=readFileSync(resolve(process.argv[2]||'desktop/plugin.js'),'utf8')
const out=resolve(process.argv[3]||'.test-output/approvals');mkdirSync(out,{recursive:true})
const assets=process.env.HERMES_ASSETS
if(!assets)throw Error('Set HERMES_ASSETS to Desktop dist/assets')
const appCss=readFileSync(join(assets,readdirSync(assets).filter(f=>/^index-.*\.css$/.test(f)).sort().at(-1)),'utf8')
const constants=src.slice(src.indexOf('const USER_BUBBLE'),src.indexOf('// ─── Stylesheet'))
const start=src.indexOf('const CSS = /* css */ `'),end=src.indexOf('\n`\n',start)
const aid=src.slice(src.indexOf('// ─── Approval reading aid'),src.indexOf('// ─── end approval reading aid'))
const mount=async p=>p.addScriptTag({content:`(()=>{${aid};createApprovalReadingAid({label:k=>({approvalScroll:'More command text below — scroll inside the preview to inspect it.',approvalScrollBack:'Scrollable command preview — scroll up to revisit earlier lines.',approvalCommand:'Command text'})[k],onDispose:f=>window.__dispose=f})})()`})
const css=new Function(`${constants};return ${src.slice(start+'const CSS = /* css */ '.length,end+2)}`)()
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;')
const btn='inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-xs'
const commands={short:'git diff --check',long:'python3 inspect_metadata.py --input ./saved/metadata.json\n# Synthetic long argument for layout only\ninspect --reference '+ 'example_'.repeat(100)+'\n'+Array.from({length:40},(_,i)=>`# Detail line ${i+1}: retained for inspection, not executed`).join('\n')}
const html=(dark,placement,command,advanced,disabled)=>`<!doctype html><html class="${dark?'dark':'light'}" data-hm data-hm-style="bubbles" data-hm-noise="results" data-hm-motion="off"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${appCss}</style><style>${css}</style><style>
:root{--ui-base:${dark?'#fff':'#000'};--ui-bg-primary:${dark?'#202124':'#fff'};--ui-chat-surface-background:var(--ui-bg-primary);--ui-text-primary:${dark?'#f0f0ef':'#202521'};--ui-text-secondary:${dark?'#c2c7c3':'#4f5c52'};--ui-text-tertiary:${dark?'#9aa59d':'#637268'};--ui-stroke-secondary:${dark?'#555':'#ddd'};--hm-in-stroke:${dark?'#505653':'#d7ddd7'};--hm-in-bg:${dark?'#303631':'#eef1ed'};--hm-r:16px;--hm-tail:6px;--hm-out-bg:${dark?'#8fc59e':'#315f42'};--hm-out-ink:${dark?'#14291a':'#fff'};--ui-accent:var(--hm-out-bg);--destructive:${dark?'#ff9999':'#a12222'};--foreground:var(--ui-text-primary)}
body{margin:0;padding:24px;font:15px/1.5 system-ui;background:${dark?'#151a17':'#f7f8f5'};color:var(--ui-text-primary)} main{max-width:720px;margin:0 auto} h1{font-size:18px;margin:0 0 6px} .intro{font-size:13px;color:var(--ui-text-secondary);margin-bottom:24px} pre{font-family:ui-monospace,monospace} .layout{display:flex;flex-direction:column;min-width:0} .sample-label{margin-bottom:10px;font-size:11px;color:var(--ui-text-tertiary)} button{cursor:pointer} button:disabled{cursor:not-allowed;opacity:.5}
</style></head><body><main><h1>Command approval</h1><p class="intro">Synthetic preview — no commands run.</p><div class="layout"><div class="sample-label">${placement==='floating'?'Floating approval':'Inline approval'}${disabled?' · sending…':''}</div><section data-slot="tool-approval-stack" data-approval-placement="${placement}" class="min-w-0 w-full max-w-xl"><div data-slot="card-stack"><div data-slot="card-stack-front"><div data-slot="card-stack-surface" class="rounded-xl border bg-(--ui-chat-surface-background)"><article data-slot="tool-approval-card" class="min-w-0"><div class="flex items-center gap-2 px-2.5 pt-2 text-xs"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m5 6 5 6-5 6m8 0h6"/></svg><span>Command</span><span class="ml-auto text-[0.6875rem] tabular-nums">1 / 3</span></div><pre class="m-0 max-h-40 overflow-auto whitespace-pre-wrap break-words px-2.5 py-2 font-mono text-xs leading-relaxed">${esc(command)}</pre><div data-slot="tool-approval-actions" class="flex items-center justify-end gap-1.5 px-2 pb-2 pt-1"><button type="button" data-slot="button" data-approval-deny class="${btn}" ${disabled?'disabled':''}>Reject</button>${advanced?`<button type="button" data-slot="button" aria-haspopup="menu" aria-expanded="false" class="${btn}" ${disabled?'disabled':''}>Always allow… <span>⌄</span></button>`:''}<button type="button" data-slot="button" data-approval-run class="${btn}" ${disabled?'disabled':''}>Run <span>↵</span></button></div></article></div></div></div></section></div></main></body></html>`
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true})
const results=[]
try{
for(const width of [360,390,1024])for(const dark of [false,true])for(const placement of ['inline','floating']){
 const p=await browser.newPage({viewport:{width,height:820},isMobile:width<500,hasTouch:width<500})
 await p.setContent(html(dark,placement,commands.long,true,false))
 await mount(p)
 const state=await p.evaluate(()=>{
  const card=document.querySelector('[data-slot=tool-approval-card]'),cr=card.getBoundingClientRect(),pre=card.querySelector('pre'),pr=pre.getBoundingClientRect()
  const buttons=[...card.querySelectorAll('[data-slot=tool-approval-actions] button')]
  const boxes=buttons.map(b=>{const r=b.getBoundingClientRect();return {label:b.textContent,top:r.top,left:r.left,right:r.right,bottom:r.bottom,height:r.height}})
  return {command:pre.textContent,contained:boxes.every(r=>r.left>=cr.left&&r.right<=cr.right)&&pr.left>=cr.left&&pr.right<=cr.right&&cr.right<=innerWidth,scrollable:pre.scrollHeight>pre.clientHeight,actionsVisible:boxes.every(r=>r.bottom<=innerHeight),touch:boxes.every(r=>r.height>=40),visualOrder:boxes.every((b,i)=>!i||b.top>boxes[i-1].top||b.left>boxes[i-1].left),boxes}
 })
 const ok=state.command===commands.long&&state.contained&&state.scrollable&&state.actionsVisible&&state.touch&&state.visualOrder
 results.push({width,dark,placement,ok,...state,command:undefined})
 console.log(`${ok?'PASS':'FAIL'} ${width}/${dark?'dark':'light'}/${placement}: ${JSON.stringify(state.boxes)}`)
 const hint=await p.locator('.hm-approval-hint').isVisible()
 await p.locator('pre').evaluate(e=>{e.scrollTop=e.scrollHeight;e.dispatchEvent(new Event('scroll'))})
 const scrolled=(await p.locator('.hm-approval-hint').textContent()).includes('scroll up')
 await p.locator('pre').evaluate(e=>{e.scrollTop=0;e.dispatchEvent(new Event('scroll'))})
 results.push({width,dark,placement,case:'scroll-notice',ok:hint&&scrolled})
 if(placement==='inline')await p.screenshot({path:join(out,`${width}-${dark?'dark':'light'}.png`)})
 // Native order must also be keyboard order; no synthetic approval dispatch.
 await p.keyboard.press('Tab'); const first=await p.evaluate(()=>document.activeElement.hasAttribute('data-approval-deny'))
 // Chromium may focus a scrollable pre first, so move to the first button explicitly.
 await p.locator('[data-approval-deny]').focus(); await p.keyboard.press('Tab')
 const middle=await p.evaluate(()=>document.activeElement.getAttribute('aria-haspopup')==='menu')
 await p.keyboard.press('Tab');const last=await p.evaluate(()=>document.activeElement.hasAttribute('data-approval-run'))
 results.push({width,dark,placement,case:'keyboard-order',ok:middle&&last})
 await p.evaluate(()=>window.__dispose())
 const cleanup=await p.evaluate(()=>!document.querySelector('.hm-approval-hint')&&!document.querySelector('pre').hasAttribute('tabindex')&&!document.querySelector('pre').hasAttribute('aria-label'))
 results.push({width,dark,placement,case:'cleanup',ok:cleanup})
 await p.setContent(html(dark,placement,commands.short,false,true))
 await mount(p)
 const limited=await p.evaluate(()=>{
  const bs=[...document.querySelectorAll('[data-slot=tool-approval-actions] button')]
  return bs.length===2&&bs.every(b=>b.disabled)&&!document.querySelector('[aria-haspopup=menu]')&&document.querySelector('.hm-approval-hint').hidden
 })
 results.push({width,dark,placement,case:'limited-disabled',ok:limited})
 await p.close()
}
}finally{await browser.close()}
writeFileSync(join(out,'results.json'),JSON.stringify(results,null,2))
const fail=results.filter(x=>!x.ok);console.log(`${results.length-fail.length}/${results.length} passed`);if(fail.length)process.exitCode=1
