import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReader, parseEnvelope, type ReadItem, type Transcript } from '../src/adapters/read.ts';
import { claudeTranscriptPath, createClaudeReader, findClaudeSession, observeClaudeSession, projectClaude } from '../src/adapters/claude.ts';
import { createCodexReader, observeCodex, projectCodex } from '../src/adapters/codex.ts';
import type { Registration } from '../src/protocol.ts';
const reg=(over:Partial<Registration>={}):Registration=>({id:'t',provider:'claude',nativeId:'n1',generation:'g1',host:'local',displayName:'d',workspace:'/w',operations:['read'],grants:[],...over});
const items=(n:number):ReadItem[]=>Array.from({length:n},(_,i)=>({nativeItemId:`i${i}`,role:'user',text:`t${i}`,at:null}));
const transcript=(n:number,over:Partial<Transcript>={}):Transcript=>({generation:'g1',items:items(n),complete:true,source:'s',omitted:[],...over});
const envelope=(over:Record<string,unknown>={})=>JSON.stringify({schemaVersion:1,id:'m1',sender:{id:'a',nativeId:'na',generation:'ga'},recipient:{id:'b',nativeId:'nb',generation:'gb'},text:'hello',replyTo:'m0',...over});

test('read pages newest first and walks the cursor to the oldest item',async()=>{
 const read=createReader({claude:async()=>transcript(5)});
 const first=await read(reg(),{limit:2});
 assert.equal(first.status,'ok');if(first.status!=='ok')return;
 assert.deepEqual(first.items.map(x=>x.nativeItemId),['i3','i4']);
 const second=await read(reg(),{limit:2,cursor:first.nextCursor!});if(second.status!=='ok')return assert.fail();
 assert.deepEqual(second.items.map(x=>x.nativeItemId),['i1','i2']);
 const last=await read(reg(),{limit:2,cursor:second.nextCursor!});if(last.status!=='ok')return assert.fail();
 assert.deepEqual(last.items.map(x=>x.nativeItemId),['i0']);assert.equal(last.nextCursor,null);
});
test('empty, absent, generation and cursor failures stay distinct',async()=>{
 assert.equal((await createReader({claude:async()=>transcript(0)})(reg())).status,'empty');
 assert.equal((await createReader({claude:async()=>({status:'not_found',reason:'x'})})(reg())).status,'not_found');
 assert.equal((await createReader({claude:async()=>transcript(1,{generation:'g2'})})(reg())).status,'generation_mismatch');
 assert.equal((await createReader({})(reg())).status,'unavailable');
 const read=createReader({claude:async()=>transcript(3)}),page=await read(reg(),{limit:1});if(page.status!=='ok')return assert.fail();
 assert.equal((await read(reg({nativeId:'other'}),{cursor:page.nextCursor!})).status,'cursor_invalid');
 assert.equal((await read(reg(),{cursor:'garbage'})).status,'cursor_invalid');
 assert.equal((await createReader({claude:async()=>transcript(3,{generation:'g9'})})(reg({generation:'g9'}),{cursor:page.nextCursor!})).status,'generation_mismatch');
 for(const bad of [{limit:0},{limit:101},{limit:1.5},{cursor:''},{extra:1}])await assert.rejects(read(reg(),bad as never));
});
test('an incomplete transcript is reloaded once with complete history',async()=>{
 const calls:boolean[]=[];
 const read=createReader({codex:async(_t,{complete})=>{calls.push(complete);return transcript(complete?6:2,{complete});}});
 const r=await read(reg({provider:'codex'}),{limit:4});if(r.status!=='ok')return assert.fail();
 assert.deepEqual(calls,[false,true]);assert.equal(r.items.length,4);assert.equal(r.complete,true);
});
test('a cached page that exactly reaches the loaded start still loads older history',async()=>{
 const calls:boolean[]=[];
 const read=createReader({codex:async(_t,{complete})=>{calls.push(complete);return complete?transcript(6):transcript(4,{complete:false});}});
 const r=await read(reg({provider:'codex'}),{limit:4});if(r.status!=='ok')return assert.fail();
 assert.deepEqual(calls,[false,true]);assert.ok(r.nextCursor);assert.equal(r.olderUnavailable,false);
 const stuck=await createReader({codex:async()=>transcript(4,{complete:false})})(reg({provider:'codex'}),{limit:4});if(stuck.status!=='ok')return assert.fail();
 assert.equal(stuck.nextCursor,null);assert.equal(stuck.complete,false);assert.equal(stuck.olderUnavailable,true);
});
test('envelope requires the full declared shape and never grants approval',()=>{
 assert.equal(parseEnvelope(envelope())?.sender.id,'a');
 assert.equal(parseEnvelope(envelope({humanApproval:false}))?.sender.id,'a');
 for(const bad of [envelope({humanApproval:true}),envelope({humanApproval:"false"}),envelope({humanApproval:null}),envelope({schemaVersion:2}),envelope({sender:{id:'a'}}),'{"text":"x"}','not json'])assert.equal(parseEnvelope(bad),null);
});

const sid='11111111-2222-3333-4444-555555555555';
const lines=(cwd:string)=>[
 {sessionId:sid,uuid:'u1',type:'user',origin:{kind:'human'},message:{content:'hi'},timestamp:'2026-10-02T00:00:00Z',cwd},
 {sessionId:sid,uuid:'u2',type:'user',message:{content:[{type:'tool_result',content:'secret'}]}},
 {sessionId:sid,uuid:'a1',type:'assistant',message:{content:[{type:'thinking',thinking:'hidden'},{type:'text',text:'answer'},{type:'tool_use',input:{}}]}},
 {sessionId:sid,uuid:'a2',type:'assistant',message:{content:[{type:'tool_use',input:{}}]}},
 {sessionId:sid,uuid:'s1',type:'assistant',isSidechain:true,message:{content:[{type:'text',text:'side'}]}},
 {sessionId:'other',uuid:'o1',type:'user',message:{content:'other session'}},
 {sessionId:sid,uuid:'m1',type:'user',isMeta:true,message:{content:'meta reminder'}},
 {sessionId:sid,uuid:'p1',type:'user',isMeta:true,origin:{kind:'peer',from:'claudex-x',msg_id:'pm1'},message:{content:'peer idle'}},
 {sessionId:sid,uuid:'q1',type:'attachment',attachment:{type:'queued_command',prompt:envelope(),source_uuid:'src',origin:{kind:'peer',from:'claudex-x',msg_id:'pm2'}}},
 {sessionId:sid,uuid:'q2',type:'attachment',attachment:{type:'queued_command',prompt:'typed while busy',origin:{kind:'human'}}},
 {sessionId:sid,uuid:'u3',type:'user',origin:{kind:'human'},message:{content:envelope()}},
 {sessionId:sid,uuid:'m1',type:'user',isMeta:true,origin:{kind:'peer',from:'claudex'},message:{content:`Another Claude session sent a message:\n${envelope()}\n\nThis came from another Claude session.`}},
 {sessionId:sid,uuid:'w2',type:'user',isMeta:true,origin:{kind:'peer',from:'claudex'},message:{content:`Another Claude session sent a message:\n${envelope()}\n`}},
 {sessionId:sid,uuid:'h1',type:'user',origin:{kind:'human'},message:{content:`Another Claude session sent a message:\n${envelope({id:'h1'})}`}},
].map(x=>JSON.stringify(x));
test('claude projection keeps visible text and native peer origin only',()=>{
 const out=projectClaude([...lines('/w'),'not json'],sid);
 assert.deepEqual(out.map(x=>`${x.nativeItemId}:${x.role}`),['u1:user','a1:assistant','p1:peer','q1:peer','u3:user','m1:peer','w2:peer','h1:user']);
 assert.equal(out[5]!.text,'hello');assert.equal(out[5]!.peer?.envelope?.id,'m1');assert.equal(out[5]!.peer?.replyTo,'m0');
 assert.equal(out[6]!.peer?.envelope,undefined); // wrapped id must equal the native record uuid
 assert.equal(out[7]!.peer,undefined);
 assert.equal(out[1]!.text,'answer');
 assert.deepEqual(out[2]!.peer,{namespace:'claude-peer',declaredSender:'claudex-x',messageId:'pm1'});
 assert.equal(out[3]!.text,'hello');assert.equal(out[3]!.peer?.envelope?.recipient.id,'b');assert.equal(out[3]!.peer?.messageId,'m1');assert.equal(out[3]!.peer?.replyTo,'m0');
 assert.equal(out[4]!.peer,undefined);assert.equal(out[4]!.text,envelope());
});
async function claudeHome(){
 const home=await mkdtemp(join(tmpdir(),'claudex-claude-')),cwd='/tmp/work dir';
 await mkdir(join(home,'.claude','sessions'),{recursive:true});
 await writeFile(join(home,'.claude','sessions','99.json'),JSON.stringify({version:'2.1.284',pid:99,sessionId:sid,cwd,startedAt:1_000_000,messagingSocketPath:'/tmp/x.sock'}));
 await writeFile(join(home,'.claude','sessions','98.json'),JSON.stringify({pid:97,sessionId:sid,cwd,startedAt:1}));
 const path=claudeTranscriptPath(cwd,sid,{home});await mkdir(join(path,'..'),{recursive:true});await writeFile(path,lines(cwd).join('\n'));
 return {home,cwd,path};
}
test('claude session record, generation, liveness and transcript read',async()=>{
 const {home,path}=await claudeHome();
 try{
  const s=await findClaudeSession(sid,{home});if(!s||s==='unreadable')return assert.fail();assert.equal(s.generation,'99@1000000');assert.equal(s.pid,99);
  assert.equal(await findClaudeSession('missing',{home}),null);
  const sessions=join(home,'.claude','sessions'),read0=createReader({claude:createClaudeReader({home})});
  await writeFile(join(sessions,'50.json'),'{broken');
  assert.equal(await findClaudeSession('missing',{home}),'unreadable');
  assert.deepEqual(await read0(reg({nativeId:'missing'})),{status:'unavailable',reason:'session_record_unreadable'});
  assert.equal((await findClaudeSession(sid,{home}) as {pid:number}).pid,99);
  await rm(join(sessions,'50.json'));await chmod(sessions,0o000);
  try{
   assert.equal(await findClaudeSession(sid,{home}),'unreadable');
   assert.deepEqual(await read0(reg({nativeId:sid})),{status:'unavailable',reason:'session_record_unreadable'});
   assert.equal(await observeClaudeSession(reg({nativeId:sid}),{home}),null);
  }finally{await chmod(sessions,0o755);}
  assert.equal(await findClaudeSession(sid,{home:join(home,'nohome')}),null);
  const on=await observeClaudeSession(reg({nativeId:sid}),{home,processStart:async()=>1_000_500});assert.equal(on?.status,'online');assert.equal(on?.gitSource,'observeGit');assert.equal(on?.source,'claude-session-record');
  assert.equal((await observeClaudeSession(reg({nativeId:sid}),{home,processStart:async()=>9_000_000}))?.status,'offline');
  assert.equal((await observeClaudeSession(reg({nativeId:sid}),{home,processStart:async()=>null}))?.status,'offline');
  const read=createReader({claude:createClaudeReader({home})});
  const r=await read(reg({nativeId:sid,generation:'99@1000000'}),{limit:100});if(r.status!=='ok')return assert.fail(JSON.stringify(r));
  assert.equal(r.items.length,8);assert.equal(r.source,'claude-transcript');
  assert.equal((await read(reg({nativeId:sid,generation:'99@1'}))).status,'generation_mismatch');
  assert.equal((await read(reg({nativeId:'missing'}))).status,'not_found');
  const live=reg({nativeId:sid,generation:'99@1000000'});
  await chmod(path,0o000);
  assert.deepEqual(await read(live),{status:'unavailable',reason:'transcript_unreadable'});
  await rm(path);
  assert.deepEqual(await read(live),{status:'not_found',reason:'transcript'});
  await symlink('/etc/hosts',path);
  assert.deepEqual(await read(live),{status:'unavailable',reason:'transcript_unreadable'});
  await rm(path);await mkdir(path);
  assert.deepEqual(await read(live),{status:'unavailable',reason:'transcript_unreadable'});
 }finally{await rm(home,{recursive:true,force:true});}
});

const tid='01a0f59d-0000-7000-8000-000000000001';
const state=(over:Record<string,unknown>={})=>({id:tid,cwd:'/tmp',turnsPagination:{hasLoadedOldest:false},turns:[{turnId:'T1',turnStartedAtMs:0,items:[
 {id:'x1',type:'userMessage',content:[{type:'text',text:'q'},{type:'image',url:'data:'}]},
 {id:'x2',type:'reasoning',content:'hidden'},
 {id:'x3',type:'commandExecution',aggregatedOutput:'secret'},
 {id:'x4',type:'agentMessage',text:'a'},
 {id:'x5',type:'functionCallOutput',namespace:'claudex',name:'external_message',output:envelope()},
 {id:'x6',type:'functionCallOutput',namespace:'other',name:'external_message',output:envelope()},
 {id:'x7',type:'functionCallOutput',namespace:'claudex_test',name:'external_message',output:'{"messageId":"L1","sender":"s","message":"legacy"}'},
]}],...over});
test('codex projection keeps user, assistant and claudex peer outputs only',()=>{
 const out=projectCodex(state());
 assert.deepEqual(out.map(x=>`${x.nativeItemId}:${x.role}`),['x1:user','x4:assistant','x5:peer','x7:peer']);
 assert.equal(out[0]!.text,'q');assert.equal(out[2]!.peer?.envelope?.sender.nativeId,'na');assert.equal(out[2]!.text,'hello');
 assert.deepEqual(out[3]!.peer,{namespace:'claudex_test',declaredSender:'s',messageId:'L1'});
});
type Fake={owner:string|null;changeOwner?:boolean;loadRevision?:number;frames:any[]};
async function fakeDesktop(fake:Fake){
 const dir=await mkdtemp(join(tmpdir(),'claudex-ipc-'));await chmod(dir,0o700);const path=join(dir,'ipc.sock');
 const write=(s:Socket,f:unknown)=>{const b=Buffer.from(JSON.stringify(f)),h=Buffer.alloc(4);h.writeUInt32LE(b.length);s.write(Buffer.concat([h,b]));};
 let discoveries=0;
 const server=createServer(s=>{let buf=Buffer.alloc(0);s.on('data',d=>{buf=Buffer.concat([buf,d]);
  while(buf.length>=4&&buf.length>=buf.readUInt32LE(0)+4){const f=JSON.parse(buf.subarray(4,buf.readUInt32LE(0)+4).toString());buf=buf.subarray(buf.readUInt32LE(0)+4);fake.frames.push(f);
   if(f.method==='initialize')write(s,{type:'response',requestId:f.requestId,resultType:'success',result:{clientId:'C'}});
   else if(f.method==='thread-owner-discovery'){discoveries++;if(fake.owner)write(s,{type:'response',requestId:f.requestId,resultType:'success',handledByClientId:fake.changeOwner&&discoveries>1?'OTHER':fake.owner,result:{}});}
   else if(f.method==='thread-stream-following-changed'&&f.params.following){
    const complete=fake.loadRevision!==undefined;
    write(s,{type:'broadcast',method:'thread-stream-state-changed',version:11,sourceClientId:'SPOOF',targetClientIds:['C'],params:{hostId:'local',conversationId:tid,change:{type:'snapshot',revision:99,conversationState:state({turns:[]})}}});
    write(s,{type:'broadcast',method:'thread-stream-state-changed',version:11,sourceClientId:'OWN',targetClientIds:['C'],params:{hostId:'remote',conversationId:tid,change:{type:'snapshot',revision:99,conversationState:state({turns:[]})}}});
    write(s,{type:'broadcast',method:'thread-stream-state-changed',version:11,sourceClientId:fake.owner,targetClientIds:['C'],params:{hostId:'local',conversationId:tid,change:{type:'snapshot',revision:complete?fake.loadRevision:1,conversationState:complete?state({turnsPagination:{hasLoadedOldest:true},turnHistory:{kind:'canonical',history:{isComplete:true,islands:[{entries:[]}],entitiesByKey:{}}}}):state()}}});
   }else if(f.method==='thread-follower-load-complete-history'){fake.loadRevision=5;write(s,{type:'response',requestId:f.requestId,resultType:'success',handledByClientId:fake.owner,result:{revision:5}});}
  }});});
 await new Promise<void>(r=>server.listen(path,r));
 return {path,dir,close:async()=>{server.close();await rm(dir,{recursive:true,force:true});}};
}
const supported={version:async()=>'26.928.40906+12694'};
test('codex reader follows only the owner, loads history, and always unfollows',async()=>{
 const fake:Fake={owner:'OWN',frames:[]},d=await fakeDesktop(fake);
 try{
  const read=createReader({codex:createCodexReader({socketPath:d.path,...supported})});
  const r=await read(reg({provider:'codex',nativeId:tid,generation:'OWN'}),{limit:10});if(r.status!=='ok')return assert.fail(JSON.stringify(r));
  assert.equal(r.complete,true);assert.equal(r.items.length,4);assert.equal(r.source,'codex-desktop:26.928.40906+12694');
  assert.ok(fake.frames.some(f=>f.method==='thread-follower-load-complete-history'&&f.targetClientId==='OWN'));
  const unfollowed=()=>fake.frames.filter(f=>f.method==='thread-stream-following-changed').at(-1)?.params.following===false;
  for(let i=0;i<50&&!unfollowed();i++)await new Promise(r=>setTimeout(r,10));
  assert.ok(unfollowed());
  assert.ok(fake.frames.every(f=>f.method!=='thread-follower-start-turn'));
  assert.equal((await read(reg({provider:'codex',nativeId:tid,generation:'OLD'}))).status,'generation_mismatch');
  const o=await observeCodex(reg({provider:'codex',nativeId:tid}),{socketPath:d.path,...supported});
  assert.equal(o?.generation,'OWN');assert.equal(o?.cwd,'/tmp');assert.equal(o?.source,'codex-desktop-owner');assert.equal(o?.gitSource,'observeGit');
 }finally{await d.close();}
});
test('codex reader rejects unsupported versions, owner changes, and separates offline from absent',async()=>{
 const fake:Fake={owner:'OWN',changeOwner:true,frames:[]},d=await fakeDesktop(fake);
 const home=await mkdtemp(join(tmpdir(),'claudex-codex-'));
 try{
  const t=reg({provider:'codex',nativeId:tid,generation:'OWN'});
  assert.deepEqual(await createReader({codex:createCodexReader({socketPath:d.path,version:async()=>'1.0+1'})})(t),{status:'unsupported_version',reason:'1.0+1'});
  assert.equal(fake.frames.length,0);
  assert.equal((await createReader({codex:createCodexReader({socketPath:d.path,...supported})})(t)).status,'generation_mismatch');
  fake.owner=null;const opts={socketPath:d.path,codexHome:home,timeoutMs:300,...supported};
  assert.equal((await createReader({codex:createCodexReader(opts)})(t)).status,'not_found');
  await mkdir(join(home,'sessions','2026','10','02'),{recursive:true});await writeFile(join(home,'sessions','2026','10','02',`rollout-x-${tid}.jsonl`),'');
  assert.deepEqual(await createReader({codex:createCodexReader(opts)})(t),{status:'unavailable',reason:'owner_offline'});
  await rm(join(home,'sessions','2026','10','02',`rollout-x-${tid}.jsonl`));await chmod(join(home,'sessions'),0o000);
  try{assert.deepEqual(await createReader({codex:createCodexReader(opts)})(t),{status:'unavailable',reason:'rollout_unreadable'});}
  finally{await chmod(join(home,'sessions'),0o755);}
  assert.equal((await createReader({codex:createCodexReader({...opts,socketPath:join(home,'none.sock')})})(t)).status,'unavailable');
 }finally{await d.close();await rm(home,{recursive:true,force:true});}
});

test('codex projection reads seamless and seamless_test peer namespaces',()=>{
 const snapshot=state();
 for(const turn of snapshot.turns)for(const item of turn.items){if('namespace' in item&&typeof item.namespace==='string')item.namespace=item.namespace.replace('claudex','seamless');}
 const out=projectCodex(snapshot);
 assert.deepEqual(out.map(x=>`${x.nativeItemId}:${x.role}`),['x1:user','x4:assistant','x5:peer','x7:peer']);
 assert.equal(out[2].peer?.namespace,'seamless');assert.equal(out[2].peer?.envelope?.id,'m1');assert.equal(out[3].peer?.namespace,'seamless_test');
});
