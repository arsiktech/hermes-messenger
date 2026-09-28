// Real reply/quote UI + draft writer in Chrome, with a synthetic composer SDK.
// No sends, live chats, queue operations or real drafts.
import {readFileSync,mkdirSync} from 'node:fs'
import {createRequire} from 'node:module'
import {resolve,join} from 'node:path'
const require=createRequire(process.env.HERMES_SOURCE?join(process.env.HERMES_SOURCE,'package.json'):import.meta.url)
const {chromium}=require('playwright')
const source=readFileSync(resolve(process.argv[2]||'desktop/plugin.js'),'utf8'),out=resolve(process.argv[3]||'.test-output/reply-draft-ui');mkdirSync(out,{recursive:true})
const constants=source.slice(source.indexOf('const USER_BUBBLE'),source.indexOf('// ─── Stylesheet'))
const start=source.indexOf('const CSS = /* css */ `'),end=source.indexOf('\n`\n',start)
const css=new Function(`${constants};return ${source.slice(start+'const CSS = /* css */ '.length,end+2)}`)()
const replies=source.slice(source.indexOf('// ─── Replies & quotes (SDK-free'),source.indexOf('// ─── end replies'))
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true})
let count=0;const check=(n,ok)=>{if(!ok)throw Error(n);console.log('PASS '+n);count++}
try{
const p=await browser.newPage({viewport:{width:980,height:760}}),errors=[];p.on('pageerror',e=>{errors.push(String(e));console.error('PAGE ERROR',String(e))})
await p.setContent(`<!doctype html><html data-hm data-hm-style="bubbles" data-hm-motion="off"><head><style>${css}</style><style>body{font:15px/1.5 system-ui;padding:32px;background:#202522;color:#eee;--ui-base:#fff;--ui-bg-primary:#283129;--ui-text-primary:#eee;--ui-text-secondary:#c0cac1;--hm-in-bg:#303b32;--hm-in-stroke:#536555;--hm-r:16px;--hm-tail:6px;--hm-out-bg:#a5d5aa;--hm-out-ink:#172c19}[data-slot=aui_assistant-message-content]{margin:16px 0}.aui-md{display:inline-block;padding:12px;max-width:620px}textarea{box-sizing:border-box;width:100%;height:180px;padding:14px;border:1px solid #6b806e;border-radius:12px;background:#283129;color:#eee;font:14px/1.5 system-ui}h1{font-size:18px}small{color:#c0cac1}</style></head><body><h1>Visible reply draft · synthetic preview</h1><section data-session-anchor="session-tile:chat-1"><div data-slot="aui_assistant-message-root"><div data-slot="aui_assistant-message-content"><div id="one" class="aui-md">This is the first message. It contains the context I want to reply to.</div></div></div><div data-slot="aui_assistant-message-root"><div data-slot="aui_assistant-message-content"><div id="two" class="aui-md">Quote just this phrase, not the whole message.</div></div></div><small>The reference is part of the editable draft. Nothing is sent automatically.</small><textarea aria-label="Draft">My existing answer.</textarea></section></body></html>`)
await p.addScriptTag({content:`${constants};${replies};const host={state:{focusedSessionId:{get:()=> 'runtime-1'},activeSessionId:{get:()=> 'runtime-1'},focusedStoredSessionId:{get:()=> 'chat-1'},focusedSessionOwner:{get:()=>({connectionId:'local',profile:'synthetic'})}}};window.__writes=[];window.__notices=[];const composer={getDraft:async sid=>document.querySelector('textarea').value,setDraft:async(sid,text)=>{window.__writes.push({sid,text});document.querySelector('textarea').value=text;return true}};const write=createReplyDraftWriter({composer,getScope:replyDraftScope,notify:m=>window.__notices.push(m),label:k=>k,onDispose:()=>{}});createReplies({setReply:write,label:k=>({reply:'Reply',quote:'Quote',you:'You',agent:'Agent'})[k]||k,onDispose:()=>{}})`})
await p.hover('#one');await p.locator('.hm-reply-btn').click();await p.waitForFunction(()=>document.querySelector('textarea').value.startsWith('[Replying to'))
let value=await p.locator('textarea').inputValue()
check('clicking Reply embeds selected message in visible draft',value.includes('This is the first message.')&&value.endsWith('My existing answer.'))
check('write addressed to source runtime',await p.evaluate(()=>window.__writes.every(w=>w.sid==='runtime-1')))
check('no hidden reply bar remains',await p.locator('.hm-replybar').count()===0)
await p.evaluate(()=>{const n=document.getElementById('two').firstChild;const r=document.createRange();r.setStart(n,0);r.setEnd(n,22);const s=getSelection();s.removeAllRanges();s.addRange(r);document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))})
await p.locator('.hm-quote-pill[data-show]').click();await p.waitForFunction(()=>document.querySelector('textarea').value.includes('Quote just this phrase'))
value=await p.locator('textarea').inputValue()
check('Quote replaces reply reference with selected phrase',value.includes('Quote just this phrase')&&!value.includes('This is the first message.'))
check('replacement preserves typed answer and has one prefix',value.endsWith('My existing answer.')&&value.split('[Replying to').length===2)
await p.screenshot({path:join(out,'visible-quote.png')})
await p.locator('textarea').fill('I removed the quote myself.')
check('removing visible quote leaves no hidden send metadata',await p.locator('.hm-replybar').count()===0&&(await p.locator('textarea').inputValue())==='I removed the quote myself.')
check('no unexpected notices',await p.evaluate(()=>window.__notices.length===0))
check('no browser errors',errors.length===0)
}finally{await browser.close()}
console.log(`${count}/${count} passed`)
