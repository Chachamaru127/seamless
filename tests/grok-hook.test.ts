import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir,writeFile,readFile,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {runGrokHook,type HookOptions} from '../src/grok-hook.ts';
import {putEnvelope,ensureInbox,keyOf,receipts,type GrokEnvelope} from '../src/grok-inbox.ts';
import {grokHome,ids,OPENED} from './support/grok-fixture.ts';
const GEN='501@'+OPENED,HOOK='global/seamless:stop[0].hooks[0]';
const envelope=(id:string,generation=GEN,at=1):GrokEnvelope=>({schemaVersion:1,id,sender:{id:'claude:claude-a',nativeId:'claude-a',generation:'41@100'},recipient:{id:'grok:'+ids.live,nativeId:ids.live,generation},text:'lsof の回数を数えて',acceptedAt:at});
const stop=(reason='end_turn')=>({hookEventName:'stop',sessionId:ids.live,cwd:'/w',reason,stopHookActive:false,promptId:'p1'});
async function setup(t:Parameters<typeof grokHome>[0]){
 const f=await grokHome(t),dir=await ensureInbox(f.home,ids.live);
 const ls=async(state:string)=>(await readdir(join(dir,state))).filter(n=>n.endsWith('.json'));
 const opts=(pid:number,more:Partial<HookOptions>={}):HookOptions=>({home:f.home,ppid:501,pid,now:()=>1791448141653,hookName:HOOK,emit:()=>{},...f.grok,...more});
 return {f,dir,ls,opts};
}
test('one envelope: delivered with a receipt (request, conversation, generation, hook time, Stop reason, hook name)',async t=>{
 const s=await setup(t);await putEnvelope(s.f.home,envelope('r1'));
 const r=await runGrokHook(stop(),s.opts(7001));
 assert.equal(r.delivered,'r1');assert.match(r.output!,/SEAMLESS|seamless/);
 const out=JSON.parse(r.output!);assert.equal(out.hookSpecificOutput.hookEventName,'Stop');assert.match(out.hookSpecificOutput.additionalContext,/lsof の回数を数えて/);
 assert.match(out.hookSpecificOutput.additionalContext,/立花さんの承認ではありません/);
 assert.deepEqual(await s.ls('pending'),[]);assert.deepEqual(await s.ls('delivered'),[keyOf('r1')+'.json']);
 const [receipt]=await receipts(s.f.home,ids.live);
 assert.equal(receipt.envelope.id,'r1');assert.equal(receipt.sessionId,ids.live);assert.equal(receipt.generation,GEN);assert.equal(receipt.hookAt,1791448141653);assert.equal(receipt.reason,'end_turn');assert.equal(receipt.hookName,HOOK);
});
test('a broken envelope ahead of a good one goes to failed and the good one is delivered',async t=>{
 const s=await setup(t);await writeFile(join(s.dir,'pending',keyOf('broken')+'.json'),'{not json',{mode:0o600});await putEnvelope(s.f.home,envelope('r2',GEN,5));
 const r=await runGrokHook(stop(),s.opts(7001));
 assert.equal(r.delivered,'r2');assert.deepEqual(await s.ls('failed'),[keyOf('broken')+'.json']);assert.deepEqual(await s.ls('delivered'),[keyOf('r2')+'.json']);
});
test('an envelope for another generation of the conversation stays pending and nothing is output',async t=>{
 const s=await setup(t);await putEnvelope(s.f.home,envelope('r3','999@'+OPENED));
 const r=await runGrokHook(stop(),s.opts(7001));
 assert.equal(r.output,null);assert.deepEqual(await s.ls('pending'),[keyOf('r3')+'.json']);
});
test('the session-end Stop delivers nothing and leaves the envelope pending',async t=>{
 const s=await setup(t);await putEnvelope(s.f.home,envelope('r4'));
 for(const reason of ['shutdown','channel_closed']){const r=await runGrokHook(stop(reason),s.opts(7001));assert.equal(r.output,null);}
 assert.deepEqual(await s.ls('pending'),[keyOf('r4')+'.json']);
});
test('two hooks running at once deliver the one envelope once',async t=>{
 const s=await setup(t);await putEnvelope(s.f.home,envelope('r5'));
 const both=await Promise.all([runGrokHook(stop(),s.opts(7001,{alive:()=>true})),runGrokHook(stop(),s.opts(7002,{alive:()=>true}))]);
 assert.equal(both.filter(r=>r.delivered==='r5').length,1);assert.deepEqual(await s.ls('delivered'),[keyOf('r5')+'.json']);assert.deepEqual(await s.ls('pending'),[]);
});
test('an envelope taken by a hook that died before handing it over goes back to pending',async t=>{
 const s=await setup(t);await putEnvelope(s.f.home,envelope('r6'));
 await assert.rejects(runGrokHook(stop(),s.opts(7001,{dieAfter:'delivering'})));
 assert.deepEqual(await s.ls('delivering'),[`${keyOf('r6')}.7001.json`]);
 // A hook of another process that opened the same conversation (pid 503, another generation) only recovers it: back in pending.
 await s.f.ledger([{session_id:ids.live,pid:503,cwd:s.f.work,opened_at:OPENED}]);
 const other=await runGrokHook(stop(),s.opts(7002,{alive:pid=>pid!==7001,ppid:503}));
 assert.equal(other.output,null);assert.deepEqual(await s.ls('delivering'),[]);assert.deepEqual(await s.ls('pending'),[keyOf('r6')+'.json']);assert.deepEqual(await s.ls('unknown'),[]);
 // The conversation's own process then delivers it: it was never handed over, so this is the first delivery, not a resend.
 await s.f.ledger(s.f.rows);
 assert.equal((await runGrokHook(stop(),s.opts(7003,{alive:pid=>pid!==7001}))).delivered,'r6');
});
test('an envelope handed over by a hook that died before its receipt becomes unknown and never returns to pending',async t=>{
 const s=await setup(t);await putEnvelope(s.f.home,envelope('r7'));
 let emitted='';await assert.rejects(runGrokHook(stop(),s.opts(7001,{dieAfter:'handed',emit:x=>{emitted=x;}})));
 assert.match(emitted,/lsof/);assert.deepEqual(await s.ls('handed'),[`${keyOf('r7')}.7001.json`]);
 const next=await runGrokHook(stop(),s.opts(7002,{alive:pid=>pid!==7001}));
 assert.equal(next.output,null);assert.deepEqual(await s.ls('unknown'),[keyOf('r7')+'.json']);assert.deepEqual(await s.ls('pending'),[]);assert.deepEqual(await s.ls('delivered'),[]);
});
test('a hook whose parent is not the ledger process of the conversation delivers nothing',async t=>{
 const s=await setup(t);await putEnvelope(s.f.home,envelope('r8'));
 assert.equal((await runGrokHook(stop(),s.opts(7001,{ppid:777}))).output,null);
 assert.deepEqual(await s.ls('pending'),[keyOf('r8')+'.json']);
});
test('started as Grok starts it (node src/grok-hook.ts, Stop JSON on stdin), the hook prints the additionalContext and writes the receipt',async t=>{
 const s=await setup(t);const {processStart}=await import('../src/adapters/claude.ts');
 // The test process is the hook's parent, standing in for the Grok TUI: its own pid and start go into the ledger.
 const started=await processStart(process.pid);assert.ok(started!==null);
 const opened=new Date(started!+500).toISOString();
 await s.f.ledger([{session_id:ids.live,pid:process.pid,cwd:s.f.work,opened_at:opened}]);
 await putEnvelope(s.f.home,envelope('r9',`${process.pid}@${opened}`));
 const child=spawn(process.execPath,[await realpath(new URL('../src/grok-hook.ts',import.meta.url).pathname)],{env:{...process.env,HOME:s.f.home,GROK_HOOK_NAME:HOOK},stdio:['pipe','pipe','pipe']});
 let out='';child.stdout.on('data',d=>out+=d);child.stdin.end(JSON.stringify(stop()));
 const code=await new Promise(r=>child.on('close',r));
 assert.equal(code,0);assert.match(JSON.parse(out).hookSpecificOutput.additionalContext,/lsof の回数を数えて/);
 const [receipt]=await receipts(s.f.home,ids.live);assert.equal(receipt.envelope.id,'r9');assert.equal(receipt.hookName,HOOK);assert.equal(receipt.hookPid,child.pid);
});
