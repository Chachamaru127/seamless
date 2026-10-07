import test from 'node:test';
import assert from 'node:assert/strict';
import {createAutomatic,issueTicket} from '../src/automatic.ts';
import {wakeCodexThread,type SessionIdentity,type ThreadRow} from '../src/sessions-scan.ts';
import type {Caller} from '../src/caller.ts';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const ID='01a114be-55c5-7c80-8fb2-505f6d8e2e6b';
const rows=async():Promise<ThreadRow[]>=>[{id:ID,cwd:'/tmp',archived:0,updated_at_ms:1}];
function opener(){const urls:string[]=[];return {urls,open:async(url:string)=>{urls.push(url);}};}

test('wake opens the thread link once and returns the owner Desktop then reports',async()=>{
 const o=opener();let asked=0;
 const owner=await wakeCodexThread(ID,{rows,reachable:async()=>true,openUrl:o.open,wakeIntervalMs:0,owner:async()=>++asked>=2&&o.urls.length?'desktop':null});
 assert.equal(owner,'desktop');assert.deepEqual(o.urls,[`codex://threads/${ID}`]);
});
test('wake gives up after its attempts',async()=>{
 const o=opener();let asked=0;
 assert.equal(await wakeCodexThread(ID,{rows,reachable:async()=>true,openUrl:o.open,wakeIntervalMs:0,wakeAttempts:3,owner:async()=>{asked++;return null;}}),null);
 assert.equal(asked,3);assert.equal(o.urls.length,1);
});
test('wake never opens a malformed, unknown or archived id, or when Desktop is not running',async()=>{
 const o=opener(),owner=async()=>'desktop';
 assert.equal(await wakeCodexThread('x;open -a Calculator',{rows,reachable:async()=>true,openUrl:o.open,owner}),null);
 assert.equal(await wakeCodexThread('01a114be-0000-7c80-8fb2-505f6d8e2e6b',{rows,reachable:async()=>true,openUrl:o.open,owner}),null);
 assert.equal(await wakeCodexThread(ID,{rows:async()=>[{id:ID,cwd:'/tmp',archived:1,updated_at_ms:1}],reachable:async()=>true,openUrl:o.open,owner}),null);
 assert.equal(await wakeCodexThread(ID,{rows:async()=>null,reachable:async()=>true,openUrl:o.open,owner}),null);
 assert.equal(await wakeCodexThread(ID,{rows,reachable:async()=>false,openUrl:o.open,owner}),null);
 assert.deepEqual(o.urls,[]);
});

async function fixture(t:{after:(fn:()=>Promise<void>)=>void},targetProvider:'codex'|'claude'='codex'){
 const home=await realpath(await mkdtemp(join(tmpdir(),'cldx-wake-')));t.after(()=>rm(home,{recursive:true,force:true}));
 const caller:Caller={provider:'claude',nativeId:'a',generation:'g',cwd:home,socket:'unused',source:'codex-turn-metadata'};
 const asleep:SessionIdentity={provider:targetProvider,nativeId:ID,generation:'',cwd:home,socket:'unused',status:'unknown',reason:'unreachable'};
 const awake:SessionIdentity={provider:targetProvider,nativeId:ID,generation:'desktop',cwd:home,socket:'unused'};
 let woken=false;const wakes:string[]=[];const sent:unknown[]=[];
 const automatic=createAutomatic({home,limitsPath:join(home,'limits.json'),caller:async()=>({status:'ok',caller}),
  scan:async()=>({sessions:[caller,woken?awake:asleep],codexWorkspace:'observed'}),
  inspect:async n=>n.nativeId===ID?(woken?{...awake}:null):caller,
  wake:async id=>{wakes.push(id);woken=true;return 'desktop';},
  scanOptions:{git:async cwd=>({state:'no_git',workspace:cwd})},
  adapter:{read:async()=>null,send:async(_t:unknown,e:unknown)=>{sent.push(e);return {status:'submitted',nativeMessageId:'m'};}} as any,
  reservationDir:join(home,'reservations')});
 return {automatic,wakes,sent,awake,sleep:()=>{woken=false;}};
}
test('naming an unowned Codex conversation wakes it and returns a ticket',async t=>{
 const f=await fixture(t);
 const r=await f.automatic('sessions',{target:`codex:${ID}`,scope:'any'});
 assert.deepEqual(f.wakes,[ID]);assert.equal(r.candidates.length,1);assert.equal(r.candidates[0].status,'online');assert.equal(typeof r.candidates[0].ticket,'string');
});
test('listing without a target never wakes',async t=>{
 const f=await fixture(t);
 const r=await f.automatic('sessions',{scope:'any',includeOffline:true});
 assert.deepEqual(f.wakes,[]);assert.equal(r.candidates[0].ticket,null);
});
test('naming an unowned Claude session never wakes',async t=>{
 const f=await fixture(t,'claude');
 await f.automatic('sessions',{target:`claude:${ID}`,scope:'any'});
 assert.deepEqual(f.wakes,[]);
});
test('send to a Codex conversation that lost its owner wakes it once, then delivers',async t=>{
 const f=await fixture(t);f.sleep();
 const r=await f.automatic('send',{ticket:issueTicket(f.awake),id:'wake-1',text:'hello',scope:'any'});
 assert.equal(r.status,'submitted');assert.deepEqual(f.wakes,[ID]);assert.equal(f.sent.length,1);
});
