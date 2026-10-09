import test from 'node:test';
import assert from 'node:assert/strict';
import {projectClaudeSentIds} from '../src/adapters/claude.ts';
import {projectCodexSentIds} from '../src/adapters/codex.ts';
import {issueTicket} from '../src/automatic.ts';
import {verifyInbound} from '../src/inbound.ts';
import type {Registration} from '../src/protocol.ts';
const recipient={provider:'codex' as const,nativeId:'b'};
const ticket=issueTicket({...recipient,generation:'g',cwd:'/tmp'});
const target:Registration={id:'claude:a',provider:'claude',nativeId:'a',generation:'g',workspace:'/tmp',host:'local',displayName:'a',operations:['read'],grants:[]};
test('Claude sends project only matching IDs from assistant tool use',()=>{
 const line=(type:string,name:string,input:unknown)=>JSON.stringify({sessionId:'a',type,uuid:'u',message:{content:[{type:'tool_use',name,input}]}});
 assert.deepEqual(projectClaudeSentIds([line('assistant','mcp__claudex__send',{id:'one',ticket,text:'hidden'}),line('assistant','Bash',{command:`node cli.ts send '${JSON.stringify({id:'two',ticket,text:'hidden'})}'`}),line('user','Bash',{command:'send fake'})],'a',['one','two','fake'],recipient),['one','two']);
});
test('Codex sends require claudex server and exact argument ID',()=>{
 const item=(server:string,id:string)=>({type:'mcpToolCall',server,tool:'send',arguments:{id,ticket,text:'hidden'}});
 assert.deepEqual(projectCodexSentIds({turns:[{items:[item('claudex','one'),item('other','fake'),{type:'agentMessage',text:'send fake'}]}]},['one','fake'],recipient),['one']);
});
test('inbound verifies recorded send, keeps forgery declared, returns no body',async()=>{
 const received=['one','fake'].map(id=>({id,sender:{id:'claude:a',nativeId:'a',generation:'g'},recipient:{id:'codex:b',nativeId:'b',generation:'g'},at:new Date(1000).toISOString()}));
 const result=await verifyInbound({caller:{...target,id:'codex:b',provider:'codex',nativeId:'b'},received,targets:[target],now:1000,canRead:async()=>true,sentIds:async()=>['one']});
 assert.deepEqual(result.map(r=>r.sender),['verified','declared']);assert.deepEqual(Object.keys(result[0]).sort(),['at','from','id','sender']);
});
test('inbound filters recipient and time, caps at ten, and honors read denial',async()=>{
 const received=Array.from({length:15},(_,i)=>({id:String(i),sender:{id:'claude:a',nativeId:'a',generation:'g'},recipient:{id:'codex:b',nativeId:'b',generation:'g'},at:new Date(1000+i).toISOString()}));
 received.push({...received[0],id:'old',at:new Date(0).toISOString()},{...received[0],id:'future',at:new Date(999999999).toISOString()},{...received[0],id:'wrong',recipient:{...received[0].recipient,nativeId:'other'}});
 let reads=0;
 const result=await verifyInbound({caller:{...target,id:'codex:b',provider:'codex',nativeId:'b'},received,targets:[target],now:86400500,canRead:async()=>false,sentIds:async()=>{reads++;return ['14'];}});
 assert.equal(result.length,10);assert.equal(result[0].id,'14');assert.equal(result.every(r=>r.sender==='declared'),true);assert.equal(reads,0);
});
test('sender generation mismatch and read failure stay declared',async()=>{
 const received=[{id:'one',sender:{id:'claude:a',nativeId:'a',generation:'old'},recipient:{id:'codex:b',nativeId:'b',generation:'g'},at:new Date(1000).toISOString()}];
 const options={caller:{...target,id:'codex:b',provider:'codex' as const,nativeId:'b'},received,targets:[target],now:1000,canRead:async()=>true,sentIds:async():Promise<string[]>=>{throw Error('hidden');}};
 assert.equal((await verifyInbound(options))[0].sender,'declared');received[0].sender.generation='g';assert.equal((await verifyInbound(options))[0].sender,'declared');
});

for(const provider of ['claude','codex'] as const)test(`${provider} inbound rejects short IDs, unrelated calls and other destinations`,async()=>{
 const caller={...target,...recipient,id:'codex:b'};
 const wrongTicket=issueTicket({...recipient,nativeId:'other',generation:'g',cwd:'/tmp'});
 const wrongProvider=issueTicket({...recipient,provider:'claude',generation:'g',cwd:'/tmp'});
 const calls=[{id:'actual-send',ticket},{id:'same',ticket:wrongTicket},{id:'provider',ticket:wrongProvider},{id:'no-target'}, {id:'ok',ticket}];
 const line=(name:string,input:unknown)=>JSON.stringify({sessionId:'a',type:'assistant',message:{content:[{type:'tool_use',name,input}]}});
 const lines=[...calls.map(input=>line('mcp__claudex__send',input)),line('Read',{file_path:'send'}),line('Bash',{command:'echo send a'}),line('Bash',{command:`node cli.ts send 'not json send a'`})];
 const state={turns:[{items:[...calls.map(arguments_=>({type:'mcpToolCall',server:'claudex',tool:'send',arguments:arguments_})),{type:'mcpToolCall',server:'other',tool:'send',arguments:{id:'send',ticket}},{type:'mcpToolCall',server:'claudex',tool:'send',arguments:'send a'}]}]};
 const received=['send','a','same','provider','no-target','ok'].map(id=>({id,sender:{id:'claude:a',nativeId:'a',generation:'g'},recipient:{id:'codex:b',nativeId:'b',generation:'g'},at:new Date(1000).toISOString()}));
 const result=await verifyInbound({caller,received,targets:[target],now:1000,canRead:async()=>true,sentIds:async(_target,ids,to)=>provider==='claude'?projectClaudeSentIds(lines,'a',ids,to):projectCodexSentIds(state,ids,to)});
 assert.deepEqual(result.map(r=>r.sender),['declared','declared','declared','declared','declared','verified']);
});
test('Bash evidence accepts literal cli.ts send JSON only with exact ID and recipient',()=>{
 const line=(command:string)=>JSON.stringify({sessionId:'a',type:'assistant',message:{content:[{type:'tool_use',name:'Bash',input:{command}}]}});
 const args=JSON.stringify({id:'send',ticket,text:'with spaces'});
 const valid=`node /tmp/cli.ts send '${args}'`;
 assert.deepEqual(projectClaudeSentIds([line(valid)],'a',['send','s'],recipient),['send']);
 for(const command of [`echo ${valid}`,`${valid} && echo done`,`node cli.ts send '{broken}'`,`node cli.ts send '${JSON.stringify({id:'sender',ticket})}'`,`node cli.ts send '$ARGS'`])assert.deepEqual(projectClaudeSentIds([line(command)],'a',['send'],recipient),[]);
});
test('Codex JSON arguments and explicit target require exact recipient',()=>{
 const call=(args:unknown)=>({turns:[{items:[{type:'mcpToolCall',server:'claudex',tool:'send',arguments:args}]}]});
 assert.deepEqual(projectCodexSentIds(call(JSON.stringify({id:'x',target:'codex:b'})),['x'],recipient),['x']);
 assert.deepEqual(projectCodexSentIds(call({id:'x',target:'claude:b'}),['x'],recipient),[]);
});

for(const name of ['mcp__seamless__send','seamless.send','seamless__send','mcp__seamless.send'])test(`Claude sent IDs accept ${name}`,()=>{
 const line=JSON.stringify({sessionId:'a',type:'assistant',uuid:'u',message:{content:[{type:'tool_use',name,input:{id:'one',ticket,text:'hidden'}}]}});
 assert.deepEqual(projectClaudeSentIds([line],'a',['one'],recipient),['one']);
});
test('Codex sent IDs accept seamless server',()=>{
 const item={type:'mcpToolCall',server:'seamless',tool:'send',arguments:JSON.stringify({id:'one',ticket,text:'hidden'})};
 assert.deepEqual(projectCodexSentIds({turns:[{items:[item]}]},['one'],recipient),['one']);
});
for(const name of ['mcp__seamless_test__send','mcp__seamlessx__send','mcp__claudex_test__send','mcp__seamless__sendx','xseamless.send'])test(`Claude sent IDs reject look-alike tool ${name}`,()=>{
 const line=JSON.stringify({sessionId:'a',type:'assistant',uuid:'u',message:{content:[{type:'tool_use',name,input:{id:'one',ticket,text:'hidden'}}]}});
 assert.deepEqual(projectClaudeSentIds([line],'a',['one'],recipient),[]);
});
test('Codex sent IDs reject test and look-alike servers',()=>{
 const item=(server:string)=>({type:'mcpToolCall',server,tool:'send',arguments:JSON.stringify({id:'one',ticket,text:'hidden'})});
 assert.deepEqual(projectCodexSentIds({turns:[{items:['seamless_test','claudex_test','seamlessx','Seamless'].map(item)}]},['one'],recipient),[]);
});
// TC-4 (specs/202610-more-peers): between Claude and Codex too, a reply received and ten minutes passing (test clock) make no new request.
test('ten minutes after a Codex reply arrives (test clock), seamless has made no new request',async t=>{
 const {mkdtemp,rm,realpath,readdir}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const {createAutomatic,issueTicket}=await import('../src/automatic.ts');
 const home=await realpath(await mkdtemp(join(tmpdir(),'seamless-tc4-')));t.after(()=>rm(home,{recursive:true,force:true}));
 const T=Date.parse('2026-10-08T13:52:52Z');let now=T,sends=0;
 const caller={provider:'claude' as const,nativeId:'claude-a',generation:'41@100',cwd:home,socket:'unused',source:'claude-ancestor' as const};
 const codex={provider:'codex' as const,nativeId:'codex-b',generation:'owner-1',cwd:home,socket:'unused'};
 const reply={id:'tc1-reply',replyTo:'tc1',sender:{id:'codex:codex-b',nativeId:'codex-b',generation:'owner-1'},recipient:{id:'claude:claude-a',nativeId:'claude-a',generation:'41@100'},at:new Date(T).toISOString()};
 const automatic=createAutomatic({home,limitsPath:join(home,'limits.json'),clock:{now:()=>now,sleep:async()=>{}},caller:async()=>({status:'ok',caller}),
  scan:async()=>({sessions:[caller,{...codex}],codexWorkspace:'observed'}),inspect:async()=>({...codex}),scanOptions:{git:async cwd=>({state:'no_git',workspace:cwd})},
  adapter:{read:async()=>({status:'ok',items:[]}),send:async(_t,e)=>{sends++;return {status:'submitted',nativeMessageId:e.id};},received:async()=>[reply],structure:async()=>[]}});
 await automatic('send',{ticket:issueTicket({...codex,branch:null}),id:'tc1',text:'x'});
 const count=async()=>(await readdir(join(home,'.seamless','reservations')).catch(()=>[])).filter(n=>/^[0-9a-f]{64}\.json$/.test(n)).length;
 assert.equal(await count(),1);assert.equal(sends,1);
 for(const method of ['band','sessions'])await automatic(method,{});
 now=T+10*60_000;
 for(const method of ['band','sessions'])await automatic(method,{});
 assert.equal(await count(),1);assert.equal(sends,1);
});

// specs/202610-more-peers T2-5 (AC6, the Grok Bot side): a reply from a registered outside sender is tied to the request it answers,
// and receiving it makes no new request.
const claudeB=(work:string)=>({provider:'claude' as const,nativeId:'claude-b',generation:'42@100',cwd:work});
test('a Bot reply names the request it answers: an unknown replyTo, another registration\'s request, another conversation, a reply to a reply and a restarted requester are all invalid_reply',async t=>{
 const {externalFixture,requestToBot,peerRecord,secondRecord}=await import('./support/signed-fixture.ts');
 const f=await externalFixture(t);await f.writePeers(peerRecord({scope:[f.work]}),secondRecord({scope:[f.work]}));
 const from=claudeB(f.work);
 await requestToBot(f.reservations,{id:'ask-1',from});
 await requestToBot(f.reservations,{id:'ask-for-second',from,bot:'second'});
 await requestToBot(f.reservations,{id:'a-reply',from,replyTo:'ask-1'});
 await requestToBot(f.reservations,{id:'ask-old',from:{...from,generation:'42@99'}});
 await requestToBot(f.reservations,{id:'ask-codex',from:{provider:'codex',nativeId:'codex-c',generation:'owner-1',cwd:f.work}});
 const reservedBefore=await f.reserved();
 const reply=(replyTo:string,over:Record<string,unknown>={})=>f.call('send',f.envelope({replyTo,id:`reply-to-${replyTo}`,...over}));
 assert.equal((await reply('no-such-request')).status,'invalid_reply');
 assert.equal((await reply('ask-for-second')).status,'invalid_reply');           // the request was addressed to another registration
 assert.equal((await reply('a-reply')).status,'invalid_reply');                 // it is itself a reply
 assert.equal((await reply('ask-old')).status,'invalid_reply');                 // the requester has been restarted since (another generation)
 assert.equal((await reply('ask-codex')).status,'invalid_reply');               // the request came from another conversation than the one addressed
 assert.equal((await reply('ask-1',{recipient:'codex:codex-c:owner-1'})).status,'invalid_reply');
 assert.equal(f.writes(),0);assert.equal(await f.reserved(),reservedBefore,'a refused reply reserves nothing');
 // The second registration cannot answer the first one's request either, even with its own good key.
 assert.equal((await f.call('send',f.envelope({sender:'second',key:f.keys.secondRecv,replyTo:'ask-1',id:'x'}),'second')).status,'invalid_reply');
 // The one real reply passes, and says which request it answers.
 const ok=await reply('ask-1');
 assert.equal(ok.status,'submitted',JSON.stringify(ok));assert.equal(f.sent[0].replyTo,'ask-1');assert.equal(f.sent[0].sender.id,'grok-bot:chachamaru');
});
test('the same reply sent again by id is a duplicate and is not written again; a different id with the same content waits on the unknown result',async t=>{
 const {externalFixture,requestToBot}=await import('./support/signed-fixture.ts');
 const f=await externalFixture(t,{outcome:'unknown'});await requestToBot(f.reservations,{id:'ask-1',from:claudeB(f.work)});
 assert.equal((await f.call('send',f.envelope({replyTo:'ask-1',id:'answer-1',text:'結果です'}))).status,'unknown');
 assert.equal((await f.call('send',f.envelope({replyTo:'ask-1',id:'answer-1',text:'結果です'}))).status,'duplicate_of_unknown');
 assert.equal((await f.call('send',f.envelope({replyTo:'ask-1',id:'answer-2',text:'結果です'}))).status,'duplicate_of_unknown');
 f.setOutcome('submitted');
 // Once a reply is confirmed delivered, sending the same id again is a duplicate of a finished request.
 assert.equal((await f.call('send',f.envelope({replyTo:'ask-1',id:'answer-3',text:'別の結果'}))).status,'submitted');
 const again=await f.call('send',f.envelope({replyTo:'ask-1',id:'answer-3',text:'別の結果'}));
 assert.equal(again.status,'duplicate');assert.equal(again.previous,'submitted');
 assert.equal(f.writes(),2);
});
test('an envelope without replyTo is accepted as a new request, and seamless sends nothing back on its own',async t=>{
 const {externalFixture}=await import('./support/signed-fixture.ts');
 const f=await externalFixture(t);
 const requestsBefore=await f.reserved();
 const r=await f.call('send',f.envelope({id:'forwarded-1',text:'転送されて返信先が落ちた文'}));
 assert.equal(r.status,'submitted');assert.equal(f.sent[0].replyTo,undefined);
 // Exactly one write (the delivery itself) and one reservation (its own); no request to the Bot, no reply.
 assert.equal(f.writes(),1);assert.equal(await f.reserved(),requestsBefore+1);
 const {requests}=await import('../src/request-store.ts');
 const all=await requests(f.reservations);
 assert.equal(all.length,1);assert.equal(all[0].sender.id,'grok-bot:chachamaru');assert.equal(all.filter(x=>x.recipient.provider==='grok-bot').length,0);
 // Time passing changes nothing.
 f.advance(10*60_000);
 assert.equal(f.writes(),1);assert.equal((await requests(f.reservations)).length,1);
});
test('ten minutes after a Bot reply arrives (test clock), seamless has made no new request, from the Bot\'s side or the conversation\'s',async t=>{
 const {externalFixture,requestToBot}=await import('./support/signed-fixture.ts');const {requests}=await import('../src/request-store.ts');
 const f=await externalFixture(t);const from=claudeB(f.work);
 await requestToBot(f.reservations,{id:'ask-1',from});
 assert.equal((await f.call('send',f.envelope({replyTo:'ask-1',id:'answer-1'}))).status,'submitted');
 const delivered=f.sent[0];
 const asReceived={id:delivered.id,sender:delivered.sender,recipient:delivered.recipient,replyTo:'ask-1',at:new Date(f.now()).toISOString()};
 const claude={provider:'claude' as const,nativeId:'claude-b',generation:'42@100',cwd:f.work,socket:'unused',source:'claude-ancestor' as const};
 const mac=f.make({caller:async()=>({status:'ok',caller:claude}),adapter:{...f.adapter,received:async()=>[asReceived]}});
 const snapshot=async()=>JSON.stringify([f.writes(),(await requests(f.reservations)).map(r=>[r.id,r.sender.id,r.recipient.id,r.status]).sort(),await f.noncesWritten()]);
 const before=await snapshot();
 for(const method of ['band','sessions'])await mac(method,{});
 f.advance(10*60_000);
 for(const method of ['band','sessions'])await mac(method,{});
 // The Bot asking again for the list does not make a request either.
 await f.call('sessions',f.envelope({recipient:'*',text:'',id:'list-after'}));
 const after=JSON.parse(await snapshot()),was=JSON.parse(before);
 assert.deepEqual(after[0],was[0]);assert.deepEqual(after[1],was[1]);
 assert.equal(f.writes(),1);
 // And the reply shows up for the conversation as the Bot's, verified.
 const seen=(await mac('sessions',{peek:true})).inbound;
 assert.deepEqual(seen.map((i:any)=>[i.id,i.from.id,i.sender]),[['answer-1','grok-bot:chachamaru','verified']]);
});
test('a Bot reply to a request made before its key was rotated is still its reply (the registration is the same; only the key version moved)',async t=>{
 const {externalFixture,requestToBot,peerRecord}=await import('./support/signed-fixture.ts');
 const f=await externalFixture(t);await f.writePeers(peerRecord({scope:[f.work],keyVersion:2}));
 await requestToBot(f.reservations,{id:'ask-before-rotation',from:claudeB(f.work),botKeyVersion:1});
 const r=await f.call('send',f.envelope({keyVersion:2,replyTo:'ask-before-rotation',id:'answer-after-rotation'}));
 assert.equal(r.status,'submitted',JSON.stringify(r));assert.equal(f.sent[0].sender.generation,'2');assert.equal(f.sent[0].replyTo,'ask-before-rotation');
 // The old key version no longer signs anything.
 assert.equal((await f.call('send',f.envelope({keyVersion:1,replyTo:'ask-before-rotation',id:'old-key'}))).status,'key_version_mismatch');
});
test('a request the native side refused never reached the Bot, so it cannot be replied to; one pending or of unknown result may have, and can',async t=>{
 const {externalFixture,requestToBot}=await import('./support/signed-fixture.ts');
 const f=await externalFixture(t);const from=claudeB(f.work);
 await requestToBot(f.reservations,{id:'ask-rejected',from,status:'rejected'});
 await requestToBot(f.reservations,{id:'ask-pending',from,status:'pending'});
 await requestToBot(f.reservations,{id:'ask-unknown',from,status:'unknown'});
 await requestToBot(f.reservations,{id:'ask-submitted',from,status:'submitted'});
 const reply=(replyTo:string)=>f.call('send',f.envelope({replyTo,id:`reply-to-${replyTo}`}));
 const refused=await reply('ask-rejected');
 assert.equal(refused.status,'invalid_reply',JSON.stringify(refused));assert.equal(f.writes(),0);
 for(const id of ['ask-pending','ask-unknown','ask-submitted'])assert.equal((await reply(id)).status,'submitted',id);
 assert.equal(f.writes(),3);
});
