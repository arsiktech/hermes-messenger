// Current incoming-message view, synthetic host and DOM only. No deliveries.
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {resolve,join} from 'node:path'
const require=createRequire(process.env.HERMES_SOURCE?join(process.env.HERMES_SOURCE,'package.json'):import.meta.url)
const {chromium}=require('playwright')
const source=readFileSync(resolve(process.argv[2]||'desktop/plugin.js'),'utf8'),out=resolve(process.argv[3]||'.test-output/current-delivery');mkdirSync(out,{recursive:true})
const constants=source.slice(source.indexOf('const USER_BUBBLE'),source.indexOf('// ─── Stylesheet'))
const a=source.indexOf('const CSS = /* css */ `'),b=source.indexOf('\n`\n',a)
const css=new Function(`${constants};return ${source.slice(a+'const CSS = /* css */ '.length,b+2)}`)()
const i=source.indexOf('// ─── Current incoming message'),j=source.indexOf('// ─── end current incoming message')
const code=i<0?'':source.slice(i,j)
const threads=source.slice(source.indexOf('// ─── Bot-to-bot threads'),source.indexOf('// ─── end bot-to-bot threads'))
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true})
const results=[];const check=(name,ok)=>{results.push({name,ok});console.log(`${ok?'PASS':'FAIL'} ${name}`)}
try{
 const p=await browser.newPage({viewport:{width:1100,height:900}});const errors=[];p.on('pageerror',e=>errors.push(String(e)))
 await p.setContent(`<!doctype html><html data-hm data-hm-style="bubbles" data-hm-motion="off" data-hm-noise="results"><head><style>${css}</style><style>body{font:15px/1.5 system-ui;background:#202421;color:#eee;padding:20px;--ui-base:#fff;--ui-bg-primary:#242824;--ui-text-primary:#eee;--ui-text-secondary:#c1cbc2;--ui-accent:#a6d9ad;--hm-in-bg:#303831;--hm-in-stroke:#526055;--hm-r:16px;--hm-tail:6px}.pane{display:inline-block;vertical-align:top;width:48%;padding:12px;box-sizing:border-box}h2{font-size:16px}[data-slot=aui_thread-content]{display:flex;flex-direction:column}</style></head><body><section class="pane" data-session-anchor="session-tile:a"><h2>Bot A · synthetic</h2><div data-slot="aui_thread-content"><div data-slot="aui_response-group" id="response-a"><p>I am checking the incoming handoff.</p></div></div></section><section class="pane" data-session-anchor="session-tile:b"><h2>Bot B · must stay separate</h2><div data-slot="aui_thread-content"><div data-slot="aui_response-group"><p>A different conversation.</p></div></div></section></body></html>`)
 await p.addScriptTag({content:`${threads};const host={state:{focusedSessionId:{get:()=>window.runtime},activeSessionId:{get:()=> 'main'}}};${code};window.box=null;window.scope='connection|alpha|a';window.runtime='runtime-a';window.listener=()=>{};window.disposer=()=>{};window.publish=x=>{window.box=x;window.listener()};if(typeof createCurrentDelivery==='function')createCurrentDelivery({read:()=>window.box,listen:f=>{window.listener=f;return()=>{window.listener=()=>{}}},current:()=>({key:window.scope}),locate:currentDeliveryTranscript,label:k=>({currentHandling:'Incoming message · handling now',currentLiveCopy:'Live inbox view — not a new message',currentPreviewOnly:'Preview only: restart server after active work finishes.',inboxUnknown:'Unknown sender'})[k]||k,onDispose:f=>window.disposer=f})`})
 const body='The complete synthetic handoff, not a short preview.\n\n'+('Additional information. '.repeat(35))+'\nLAST LINE: retain this too. <img src=x onerror=alert(1)>'
 const message='Message from 🤖 Reviewer (@reviewer): '+body
 const item={id:'one',status:'claimed',session_id:'a',from:'Reviewer',body,message,preview:'The complete synthetic handoff…'}
 const box={key:'connection|alpha|a',sessionId:'a',items:[item]}
 await p.evaluate(x=>window.publish(x),box);await p.waitForTimeout(100)
 check('claimed message appears in transcript without clicking Inbox',await p.locator('[data-session-anchor="session-tile:a"] .hm-current').count()===1)
 check('full body including final line preserved',await p.evaluate(()=>document.querySelector('.hm-current-body')?.textContent ?? null)===body)
 check('current card is before the current response',await p.evaluate(()=>{const c=document.querySelector('.hm-current'),r=document.getElementById('response-a');return !!c&&!!(c.compareDocumentPosition(r)&Node.DOCUMENT_POSITION_FOLLOWING)}))
 check('other visible chat receives nothing',await p.locator('[data-session-anchor="session-tile:b"] .hm-current').count()===0)
 check('body is text, not executable HTML',await p.locator('.hm-current img').count()===0)
 if(await p.locator('.hm-current').count()){
  const stable=await p.evaluate(async()=>{const original=document.querySelector('.hm-current');for(let i=0;i<20;i++){window.listener();await new Promise(requestAnimationFrame);if(document.querySelector('.hm-current')!==original)return false}return true})
  check('polling does not rebuild or flicker the card',stable)
  await p.screenshot({path:join(out,'current-in-chat.png')})
  await p.setViewportSize({width:390,height:844})
  await p.evaluate(()=>{document.querySelector('[data-session-anchor="session-tile:a"]').style.width='100%';document.querySelector('[data-session-anchor="session-tile:b"]').style.display='none'})
  const phone=await p.locator('.hm-current-body').evaluate(e=>{const r=e.getBoundingClientRect();return r.right<=innerWidth&&e.scrollHeight>e.clientHeight&&e.textContent.includes('LAST LINE')})
  check('phone keeps full text in a bounded scrollable view',phone)
  await p.screenshot({path:join(out,'current-phone.png')})
  await p.setViewportSize({width:1100,height:900})
  await p.evaluate(()=>{document.querySelector('[data-session-anchor="session-tile:a"]').style.width='';document.querySelector('[data-session-anchor="session-tile:b"]').style.display=''})
 }
 await p.evaluate(()=>{window.scope='connection|beta|b';window.runtime='runtime-b';window.listener()})
 check('profile switch removes old full text synchronously',await p.locator('.hm-current').count()===0)
 await p.evaluate(x=>window.publish(x),box)
 check('stale old-profile update cannot reappear',await p.locator('.hm-current').count()===0)
 await p.evaluate(()=>{window.scope='connection|alpha|a';window.runtime='runtime-a'})
 await p.evaluate(x=>window.publish(x),{...box,items:[{...item,status:'queued'}]})
 check('queued message is not shown as currently handling',await p.locator('.hm-current').count()===0)
 await p.evaluate(x=>window.publish(x),{...box,items:[{...item,body:undefined,message:undefined}]})
 check('older backend honestly labels preview-only content',(await p.evaluate(()=>document.querySelector('.hm-current-note')?.textContent || ''))?.includes('Preview only'))
 await p.evaluate(x=>window.publish(x),box)
 // Once the actual thread arrives, replace the live mirror with that source,
 // open it, and keep the receiver's reply. No prompt.submit or queue calls.
 await p.evaluate(({message,body})=>{
  const root=document.createElement('div');root.setAttribute('data-slot','aui_user-message-root');root.id='real-source'
  const original=document.createElement('div');original.className='composer-human-message';original.textContent=message;original.hidden=true
  const thread=document.createElement('div');thread.className='hm-at'
  const head=document.createElement('button');head.className='hm-at-head';head.textContent='Receiver ⇄ Reviewer'
  const panel=document.createElement('div');panel.className='hm-at-body';panel.textContent=body
  head.onclick=()=>thread.toggleAttribute('data-open');thread.append(head,panel);root.append(original,thread)
  document.getElementById('response-a').before(root)
 },{message,body})
 await p.waitForTimeout(150)
 check('no second copy once original source is rendered',await p.locator('.hm-current').count()===0)
 check('actual source thread is expanded while handling',await p.locator('#real-source .hm-at[data-open]').count()===1)
 check('recipient response remains visible',await p.locator('#response-a').isVisible())
 await p.evaluate(x=>window.publish(x),{...box,items:[]})
 check('settled item loses handling marker',await p.locator('[data-hm-current-delivery]').count()===0)
 check('settlement leaves durable source intact',await p.locator('#real-source').count()===1)
 await p.locator('#real-source').evaluate(e=>e.remove())
 await p.evaluate(x=>window.publish(x),box)
 await p.evaluate(()=>window.disposer())
 check('disable removes all transient views',await p.locator('.hm-current,[data-hm-current-delivery]').count()===0)
 check('no browser errors',!errors.length)
}finally{await browser.close()}
writeFileSync(join(out,'results.json'),JSON.stringify(results,null,2));const failed=results.filter(r=>!r.ok);console.log(`${results.length-failed.length}/${results.length} passed`);if(failed.length)process.exitCode=1
