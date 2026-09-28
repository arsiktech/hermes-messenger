// Synthetic regression for bot names containing parentheses. Actual plugin
// thread renderer/CSS with a stub roster; no chat history or live actions.
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {resolve,join} from 'node:path'
const require=createRequire(process.env.HERMES_SOURCE?join(process.env.HERMES_SOURCE,'package.json'):import.meta.url)
const {chromium}=require('playwright')
const src=readFileSync(resolve(process.argv[2]||'desktop/plugin.js'),'utf8')
const out=resolve(process.argv[3]||'.test-output/agent-attribution');mkdirSync(out,{recursive:true})
const constants=src.slice(src.indexOf('const USER_BUBBLE'),src.indexOf('// ─── Stylesheet'))
const start=src.indexOf('const CSS = /* css */ `'),end=src.indexOf('\n`\n',start)
const css=new Function(`${constants};return ${src.slice(start+'const CSS = /* css */ '.length,end+2)}`)()
const threads=src.slice(src.indexOf('// ─── Bot-to-bot threads'),src.indexOf('// ─── end bot-to-bot threads'))
const raws={
 chief:'Message from 🤖 Coordinator (Chief of Staff) (@coordinator): A synthetic handoff.\n\n**Status:** ready for review.',
 nested:'Message from 🤖 Builder (Tools (Local)) (@builder): Second synthetic handoff.',
 remote:'Message from 🤖 Coordinator (Remote) (@coordinator@Remote-1): Remote synthetic report.',
 human:'I received a Message from 🤖 Coordinator (Chief of Staff) (@coordinator): what does that mean?',
 quote:'[Replying to your message: "Message from 🤖 Coordinator (Chief of Staff) (@coordinator): hi"]\nMy actual message.',
 malformed:'Message from 🤖 Coordinator (Chief of Staff) (@INVALID!): Not a supported envelope.',
 injection:'Message from 🤖 Builder (Tools) (@builder): <img src=x onerror="window.__injected=true">'
}
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;')
const html=Object.entries(raws).map(([id,text])=>`<div id="${id}" data-slot="aui_user-message-root"><div data-slot="popover-anchor"><div class="composer-human-message">${escape(text)}</div></div></div>`).join('')
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true})
const checks=[];const check=(name,ok)=>{checks.push({name,ok});console.log(`${ok?'PASS':'FAIL'} ${name}`)}
try{
 const p=await browser.newPage({viewport:{width:1000,height:900}})
 const errors=[];p.on('pageerror',e=>errors.push(String(e)))
 await p.setContent(`<!doctype html><html data-hm data-hm-style="bubbles" data-hm-motion="off"><head><style>${css}</style><style>body{font:15px/1.5 system-ui;padding:24px;background:#f7f7f5;--ui-base:#000;--ui-bg-primary:#fff;--ui-text-primary:#222;--ui-text-secondary:#555;--hm-in-bg:#eee;--hm-in-stroke:#ddd;--hm-out-bg:#315f42;--hm-out-ink:#fff;--hm-r:16px;--hm-tail:6px} [data-slot=aui_user-message-root]{display:flex;flex-direction:column;align-items:end;margin:16px 0}.composer-human-message{white-space:pre-wrap;max-width:700px;padding:12px;background:#315f42;color:#fff;border-radius:16px}</style></head><body>${html}<div id="reply" data-slot="aui_assistant-message-root"><div data-slot="aui_assistant-message-content"><div class="aui-md"><p>The recipient's separate reply remains visible.</p></div></div></div></body></html>`)
 await p.addScriptTag({content:`${threads};window.__dispose=[];createAgentThreads({request:async m=>m==='profiles.list'?{profiles:[{name:'coordinator',display_name:'Coordinator (Chief of Staff)',ui_meta:{'hermes-bots':{title:'Coordinator (Chief of Staff)'}}},{name:'builder',display_name:'Builder (Tools (Local))'},{name:'recipient',display_name:'Recipient'}]}:{messages:[]},sessionId:()=> 'synthetic-chat',selfName:()=> 'recipient',label:(k,n)=>k==='messages'?(n===1?'1 message':n+' messages'):k,onDispose:f=>window.__dispose.push(f),listen:[]})`})
 await p.waitForTimeout(650)
 const visible=async id=>p.locator('#'+id+' .composer-human-message').evaluate(e=>e.getClientRects().length>0)
 for(const id of ['chief','nested','remote','injection'])check(`${id} is not an outgoing human bubble`,!(await visible(id)))
 check('parenthesized sender is attributed',await p.locator('#chief .hm-at-head').count()===1 && (await p.locator('#chief').innerText()).includes('Coordinator (Chief of Staff)'))
 for(const id of ['human','quote','malformed'])check(`${id} remains untouched`,await visible(id))
 check('separate recipient reply kept',await p.locator('#reply').isVisible())
 check('body HTML cannot execute',!(await p.evaluate(()=>window.__injected)))
 const thread=p.locator('#chief .hm-at-head')
 if(await thread.count()){
  await thread.click()
  check('full incoming text available on expand',(await p.locator('#chief .hm-at-body').innerText()).includes('A synthetic handoff.'))
  check('markdown preserved',await p.locator('#chief .hm-at-body strong').count()===1)
  check('remote connection retained in attribution',(await p.locator('#remote .hm-at-head').innerText()).includes('Remote-1'))
  const samples=await p.evaluate(async()=>{const a=[];for(let i=0;i<30;i++){await new Promise(requestAnimationFrame);a.push(document.querySelectorAll('.hm-at').length)}return a})
  check('no duplicate cards or rendering loop',new Set(samples).size===1 && samples[0]===4)
  await p.screenshot({path:join(out,'attributed.png'),fullPage:true})
  await p.locator('#chief .composer-human-message').evaluate(e=>{e.firstChild.data='This row now contains an ordinary human message.'})
  await p.waitForTimeout(400)
  check('recycled row restores human styling',await visible('chief') && await p.locator('#chief .hm-at').count()===0)
 }
 await p.evaluate(()=>window.__dispose.forEach(f=>f()))
 check('disable restores original rows',await visible('nested')&&await visible('remote')&&await p.locator('.hm-at').count()===0)
 check('no browser errors',errors.length===0)
}finally{await browser.close()}
writeFileSync(join(out,'results.json'),JSON.stringify(checks,null,2))
const failed=checks.filter(c=>!c.ok);console.log(`${checks.length-failed.length}/${checks.length} passed`);if(failed.length)process.exitCode=1
