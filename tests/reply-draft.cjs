// Plugin draft writer + real Desktop idle/steer/queue branches. Synthetic only.
// HERMES_SOURCE=/path/to/hermes-agent node tests/reply-draft.cjs
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const repo=path.resolve(__dirname,'..');const source=fs.readFileSync(path.join(repo,'desktop/plugin.js'),'utf8');
const code=source.slice(source.indexOf('// ─── Replies & quotes (SDK-free'),source.indexOf('// ─── end replies'));
const {createReplyDraftWriter,replyWire}=vm.runInNewContext(code+'\n;({createReplyDraftWriter,replyWire})');
let passed=0;const check=(name,ok)=>{assert.ok(ok,name);passed++;console.log('PASS '+name)};
const r={kind:'reply',whose:'your',text:'Selected synthetic message.'};
function fixture(overrides={}){
 const s={draft:'My answer.',scope:{sessionId:'runtime-a',key:'local|alpha|runtime-a'},writes:[],notices:[],dispose:null};
 const composer={getDraft:async()=>s.draft,setDraft:async(sid,text)=>{s.writes.push({sid,text});s.draft=text;return true},...overrides};
 s.write=createReplyDraftWriter({composer,getScope:()=>s.scope,notify:x=>s.notices.push(x),label:k=>k,onDispose:f=>s.dispose=f});return s;
}
;(async()=>{
 let s=fixture();check('reply goes into actual draft with existing text preserved',await s.write(r)&&s.draft===replyWire(r)+'My answer.');
 const r2={...r,whose:'my',text:'Different selected message.'};await s.write(r2);check('choosing another message replaces the previous quote',s.draft===replyWire(r2)+'My answer.'&&s.draft.split('[Replying to').length===2);
 s=fixture({getDraft:async()=>null});check('missing live composer fails without writing',!(await s.write(r))&&!s.writes.length&&s.notices.length===1);
 let n=0;s=fixture({getDraft:async()=>++n===1?'Before typing':'Newer typing'});check('concurrent typing is not overwritten',!(await s.write(r))&&!s.writes.length);
 let release;s=fixture({getDraft:()=>new Promise(resolve=>{release=resolve})});let pending=s.write(r);s.scope={sessionId:'runtime-b',key:'remote|beta|runtime-b'};release('Old draft');check('scope switch during read aborts',!(await pending)&&!s.writes.length);
 s=fixture({setDraft:async()=>false});check('failed acknowledgement is reported',!(await s.write(r))&&s.notices[0]==='replyDraftUnconfirmed');
 s=fixture({getDraft:()=>new Promise(resolve=>{release=resolve})});pending=s.write(r);s.dispose();release('Old draft');check('disable cancels pending insertion',!(await pending)&&!s.writes.length);
 let first=true;s=fixture({getDraft:()=>first?(first=false,new Promise(resolve=>{release=resolve})):Promise.resolve(s.draft)});pending=s.write(r);await s.write(r2);release('Original');await pending;check('rapid reselection keeps only latest chosen source',s.writes.length===1&&s.draft.startsWith(replyWire(r2)));
 s=fixture();await s.write({...r,kind:'quote',text:'Just this selected phrase.'});check('selected-text quote uses the same draft path',s.draft===replyWire({...r,text:'Just this selected phrase.'})+'My answer.');
 const H=process.env.HERMES_SOURCE;if(!H)throw Error('HERMES_SOURCE is required for actual Desktop send-path checks');
 const req=createRequire(path.join(H,'package.json')),esbuild=req('esbuild');const home=path.join(H,'apps/desktop/src/app/chat/composer');
 const deps=`export const SLASH_COMMAND_RE=/^\\//;export const useRef=x=>({current:x});export const useLayoutEffect=()=>{};export const useMemo=f=>f();export const usePaneVisible=()=>true;export const triggerHaptic=()=>{};export const hasClarifyRequest=()=>false;export const skipClarifyRequest=()=>{};export const clearSessionDraft=()=>{};export const resetBrowseState=()=>{};export const enqueueQueuedPrompt=(...args)=>globalThis.__queued.push(args);export const hasConnectionRequest=()=>false;export const skipConnectionRequest=()=>{};export const hasBlockingPromptRequest=()=>false;export const cloneAttachments=a=>a;export const onComposerSubmitRequest=()=>()=>{};export const pathifyRefs=x=>x;export const composerPlainText=()=>'';export const useComposerScope=()=>({target:'main',attachments:{clear:()=>{}}});export const useComposerSurfaceId=()=> 'synthetic';export const registry={getArea:()=>[]};export const useContributions=()=>[];`;
 const result=await esbuild.build({stdin:{contents:`import {useComposerSubmit} from ${JSON.stringify(home+'/hooks/use-composer-submit.ts')};import {runComposerMiddleware} from ${JSON.stringify(home+'/contrib.ts')};export {useComposerSubmit,runComposerMiddleware};`,resolveDir:home},bundle:true,write:false,format:'cjs',platform:'node',plugins:[{name:'inert-environment',setup(b){b.onResolve({filter:/.*/},a=>a.path.endsWith('use-composer-submit.ts')||a.path.endsWith('/contrib.ts')?{path:a.path}:{path:a.path,namespace:'stub'});b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:deps,loader:'js'}))}}]});
 const mod={exports:{}},ctx={module:mod,exports:mod.exports,console,__queued:[]};vm.createContext(ctx);vm.runInContext(result.outputFiles[0].text,ctx);
 for(const mode of ['idle','busy','steer-refused','attachments']){
  s=fixture();await s.write(r);const expected=s.draft,ref={current:s.draft},sent=[];ctx.__queued=[];
  const attachments=mode==='attachments'?[{id:'synthetic-file',name:'fixture.txt'}]:[];
  const args={activeQueueSessionKey:'synthetic',activeQueueSessionKeyRef:{current:'synthetic'},attachments,busy:mode!=='idle',compacting:false,clearDraft:()=>{ref.current=''},disabled:false,draftRef:ref,drainNextQueued:async()=>false,editorRef:{current:null},exitQueuedEdit:()=>false,focusInput:()=>{},inputDisabled:false,loadIntoComposer:()=>{},onCancel:()=>{},onSteer:async text=>{sent.push(text);return mode!=='steer-refused'},onSteerHidden:()=>false,onSubmit:async text=>{const draft=await mod.exports.runComposerMiddleware({text});sent.push(draft.text);return true},queueCurrentDraft:()=>{sent.push(ref.current);return true},queueEdit:null,queuedPrompts:[],sessionId:'synthetic',setComposerText:()=>{},stashAt:()=>{}};
  mod.exports.useComposerSubmit(args).submitDraft();await new Promise(resolve=>setTimeout(resolve,0));
  check(`actual Desktop ${mode} route retains selected reply exactly once`,sent.length===1&&sent[0]===expected&&sent[0].split('[Replying to').length===2);
  if(mode==='steer-refused')check('steer fallback queue retains the same reply context',ctx.__queued[0]?.[1]?.text===expected);
 }
 console.log(`${passed}/${passed} passed`);
})().catch(e=>{console.error(e);process.exitCode=1});
