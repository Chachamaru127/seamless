import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {descendants,isSeamlessCli,parseProcessTable,seamlessProcesses,DEFAULT_SCOPE,fakeRegistrations,listParams,runBatch,sendParams,uniqueBody} from '../scripts/measure.ts';
import {createAutomatic} from '../src/automatic.ts';
import type {Caller} from '../src/caller.ts';
import {Delivery} from '../src/delivery.ts';
import {SAME_CONTENT_HOLD_MS} from '../src/external-inbound.ts';
import {Registry} from '../src/registry.ts';

const exec=promisify(execFile);
const REPO=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const SCRIPT=join(REPO,'scripts','measure.ts');
const CLI=join(REPO,'src','cli.ts');

async function measure(args:string[],env?:NodeJS.ProcessEnv):Promise<{stdout:string;stderr:string;json:Record<string,unknown>}>{
 const {stdout,stderr}=await exec(process.execPath,[SCRIPT,...args],{maxBuffer:16*1024*1024,timeout:180000,env:env??process.env});
 const line=stdout.trim().split('\n').filter(Boolean).pop();
 assert.ok(line,`no JSON on stdout: ${stderr}`);
 return {stdout,stderr,json:JSON.parse(line) as Record<string,unknown>};
}

test('--help lists the five measurement subcommands',async()=>{
 const {stdout}=await exec(process.execPath,[SCRIPT,'--help']);
 for(const command of ['roundtrip','hold','batch','footprint','compare'])assert.ok(stdout.includes(command),command);
});

test('a fake roundtrip reports the request id and the matching reply id as JSON',async()=>{
 const {json}=await measure(['roundtrip','--fake']);
 assert.equal(json.status,'ok');assert.equal(json.command,'roundtrip');assert.equal(json.mode,'fake');
 assert.match(String(json.requestId),/^measure-/);
 assert.match(String(json.replyId),/^reply-/);
 assert.equal(json.match,true);
});

test('a fake hold reports held, but a fake peer has no observed product reason',async t=>{
 // A fake peer has no receiving settings and no IPC, so the reason must stay unknown_reason, not the product name.
 const home=await mkdtemp(join(tmpdir(),'seamless-measure-home-'));t.after(()=>rm(home,{recursive:true,force:true}));
 await mkdir(join(home,'.seamless'),{recursive:true});
 await writeFile(join(home,'.seamless','limits.json'),JSON.stringify({version:1,exclude:[],scope:null,operations:null,heldAfterSec:20})+'\n',{mode:0o600});
 const claude=await measure(['hold','--fake','--held-after-sec','1'],{...process.env,HOME:home});
 assert.equal(claude.json.status,'ok');assert.equal(claude.json.command,'hold');
 assert.equal(claude.json.state,'held');assert.equal(claude.json.reason,'unknown_reason');
 const codex=await measure(['hold','--target','fake:codex','--held-after-sec','1'],{...process.env,HOME:home});
 assert.equal(codex.json.state,'held');assert.equal(codex.json.reason,'unknown_reason');
 // A real home whose limits say 20s must not decide the fake stage: the injected value reaches the reader as well as the clock.
 const injected=await measure(['hold','--fake','--held-after-sec','1'],{...process.env,HOME:home});
 assert.equal(injected.json.state,'held');
 // Without the flag and without a readable setting, the product default decides: Codex 45 seconds.
 const defaulted=await measure(['hold','--target','fake:codex'],{...process.env,HOME:home});
 assert.equal(defaulted.json.state,'held');
});

test('batch --plan fake:2 writes a record file without the message body',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'seamless-measure-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=join(dir,'batch.jsonl'),body='MEASURE-BODY-MUST-NOT-BE-RECORDED-7f4c';
 const {json}=await measure(['batch','--plan','fake:2','--out',file,'--text',body]);
 assert.equal(json.status,'ok');assert.equal(json.command,'batch');assert.equal(json.entries,2);
 assert.equal(json.recordFile,file);
 const raw=await readFile(file,'utf8');
 assert.equal(raw.includes(body),false);
 const records=raw.trim().split('\n').map(line=>JSON.parse(line) as Record<string,unknown>);
 assert.equal(records.length,3);
 assert.deepEqual(records[0]!.mode,'fake');
 assert.equal(records[0]!.entries,2);
 assert.equal(records[0]!.submitted,2);
 assert.deepEqual(records[0]!.notSent,{});
 assert.equal(json.submitted,2);
 assert.deepEqual(json.notSent,{});
 assert.equal(records.filter(r=>r.kind==='roundtrip').length,2);
 for(const record of records)assert.equal(JSON.stringify(record).includes('MEASURE-BODY'),false);
});

test('a peer in another folder is listed and sent to under one scope, and refused only without it',async t=>{
 // AC7 stopped 10 of 15 here: the listing asked for any, the send fell back to current_work. Both now take one value.
 const home=await mkdtemp(join(tmpdir(),'seamless-measure-scope-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const caller:Caller={provider:'codex',nativeId:'a',generation:'g',cwd:join(home,'work-a'),socket:'unused',source:'codex-turn-metadata'};
 const target={provider:'claude' as const,nativeId:'b',generation:'g',cwd:join(home,'work-b'),socket:'unused'};
 const automatic=createAutomatic({home,caller:async()=>({status:'ok',caller}),scan:async()=>({sessions:[caller,target],codexWorkspace:'observed' as const}),inspect:async()=>target,scanOptions:{git:async cwd=>({state:'no_git' as const,workspace:cwd})},adapter:{read:async()=>({status:'ok'}),send:async()=>({status:'submitted'})}});
 const narrowed=await automatic('sessions',listParams('current_work'));
 assert.deepEqual(narrowed.candidates,[]);
 const listed=await automatic('sessions',listParams(DEFAULT_SCOPE));
 assert.equal(listed.status,'ok');
 const candidate=(listed.candidates as Array<{id:string;ticket:string|null}>).find(c=>c.id==='claude:b');
 assert.ok(candidate?.ticket);
 const id=`measure-${randomUUID()}`;
 const sent=await automatic('send',sendParams(candidate.ticket,id,uniqueBody('SCOPE-BODY',1,1,id),DEFAULT_SCOPE));
 assert.equal(sent.status,'submitted',JSON.stringify(sent));
 // Without the scope the same ticket is refused before any write: the product default is the caller's folder.
 const refusedId=`measure-${randomUUID()}`;
 const refused=await automatic('send',{ticket:candidate.ticket,id:refusedId,text:uniqueBody('SCOPE-BODY',2,2,refusedId)});
 assert.equal(refused.status,'scope_conflict');
});

test('one body per send: the fixed body stops as duplicate, distinct bodies reach the same peer three times',async t=>{
 // A Bot send keeps a submitted claim for a day (src/webhook-send.ts), so the fixed body of the old hand book stopped the
 // 2nd send of a run as duplicate. The body of each send has to differ.
 const home=await mkdtemp(join(tmpdir(),'seamless-measure-body-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const {sender,recipient}=fakeRegistrations('claude');
 const sent:string[]=[];
 const delivery=new Delivery(new Registry([sender,recipient]),sender.id,{read:async()=>({status:'ok'}),send:async(_target,envelope)=>{sent.push(envelope.text);return {status:'submitted'};}},{tracking:{keyPath:join(home,'key')},fixedTarget:recipient,reservationDir:join(home,'reservations'),holdSubmittedMs:SAME_CONTENT_HOLD_MS});
 const statuses=async(texts:string[])=>{
  const out:string[]=[];
  for(const text of texts)out.push(((await delivery.send({target:recipient.id,id:`measure-${randomUUID()}`,text})) as {status:string}).status);
  return out;
 };
 assert.deepEqual(await statuses(['PREFIX-BODY','PREFIX-BODY','PREFIX-BODY']),['submitted','duplicate','duplicate']);
 const bodies=Array.from({length:3},(_,i)=>{const id=`measure-${randomUUID()}`;return uniqueBody('PREFIX-BODY',i+1,3,id);});
 assert.equal(new Set(bodies).size,3);
 bodies.forEach((body,i)=>assert.ok(body.includes(`#${i+1}/3 `),body));
 assert.deepEqual(await statuses(bodies),['submitted','submitted','submitted']);
 assert.deepEqual(sent.slice(1),bodies);
});

test('batch lists and sends under one scope, and its summary counts submitted and every reason not sent',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'seamless-measure-batch-scope-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const calls:string[][]=[],texts:string[]=[];
 const call=async(args:string[])=>{calls.push(args);
  if(args[0]==='sessions'){const p=JSON.parse(args[1]!) as {scope:string};return p.scope==='any'?{status:'ok',candidates:[{id:'claude:b',provider:'claude',ticket:'ticket-b'}]}:{status:'ok',candidates:[]};}
  if(args[0]==='send'){const p=JSON.parse(args[1]!) as {text:string;scope:string};texts.push(p.text);
   // The product refuses a send outside the caller's folder under the default scope; only `any` leaves.
   if(p.scope!=='any')return {status:'scope_conflict'};
   return p.text.includes('#3/3')?{status:'duplicate'}:{status:'submitted'};}
  return {status:'ok',delivery:'submitted',stages:[]};
 };
 const file=join(dir,'batch.jsonl');
 const result=await runBatch('claude:3',file,'PREFIX-BODY',0,'any',call);
 const listed=calls.find(c=>c[0]==='sessions');
 assert.ok(listed);
 assert.equal((JSON.parse(listed[1]!) as {scope:string}).scope,'any');
 assert.deepEqual(calls.filter(c=>c[0]==='send').map(c=>(JSON.parse(c[1]!) as {scope:string}).scope),['any','any','any']);
 assert.equal(new Set(texts).size,3);
 const lines=(await readFile(file,'utf8')).trim().split('\n').map(line=>JSON.parse(line) as Record<string,unknown>);
 assert.equal(lines[0]!.entries,3);
 assert.equal(lines[0]!.submitted,2);
 assert.deepEqual(lines[0]!.notSent,{duplicate:1});
 assert.equal(result.submitted,2);
 assert.deepEqual(result.notSent,{duplicate:1});
});

test('batch waits each product N plus five seconds unless --wait says otherwise',async t=>{
 // Issue #37: Codex takes the envelope at a turn boundary, so --wait 25 would call it held before it is delivered.
 const dir=await mkdtemp(join(tmpdir(),'seamless-measure-wait-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const waits:string[]=[];
 const candidates=[
  {id:'claude:b',provider:'claude',ticket:'ticket-claude'},
  {id:'codex:d',provider:'codex',ticket:'ticket-codex'},
  {id:'grok:e',provider:'grok',ticket:'ticket-grok'},
  {id:'grok-bot:f',provider:'grok-bot',ticket:'ticket-bot'},
 ];
 const call=async(args:string[])=>{
  if(args[0]==='sessions')return {status:'ok',candidates};
  if(args[0]==='send')return {status:'submitted'};
  if(args[0]==='status'){const at=args.indexOf('--wait');waits.push(args[at+1]!);return {status:'ok',delivery:'submitted',stages:[]};}
  return {status:'ok'};
 };
 const limits={heldAfterSec:{codex:45}};
 await runBatch('claude:1,codex-desktop:1,grok:1,grok-bot:1',join(dir,'batch.jsonl'),'BODY',undefined,'any',call,limits);
 assert.deepEqual(waits,['25','50','25','65']);
 waits.length=0;
 // An explicit --wait still decides every entry.
 await runBatch('claude:1,codex-desktop:1',join(dir,'explicit.jsonl'),'BODY',12,'any',call,limits);
 assert.deepEqual(waits,['12','12']);
});
test('batch --dry checks the plan and the product names without sending or writing a record',async t=>{
 // The AC7 line must pass the parser and report its three product names as known, before anything is sent to a real peer.
 const dir=await mkdtemp(join(tmpdir(),'seamless-measure-dry-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=join(dir,'dry.jsonl');
 const {json}=await measure(['batch','--plan','claude:5,codex-desktop:5,grok-bot:5','--out',file,'--dry']);
 assert.equal(json.status,'ok');assert.equal(json.command,'batch');assert.equal(json.dry,true);
 assert.equal(json.entries,15);assert.equal(json.recordFile,null);
 const parts=json.planParts as Array<{name:string;count:number;known:boolean}>;
 assert.deepEqual(parts.map(e=>[e.name,e.count,e.known]),[['claude',5,true],['codex-desktop',5,true],['grok-bot',5,true]]);
 assert.equal(await readdir(dir).then(names=>names.length),0);
 // A name no provider claims is reported, not thrown: the real run would write no_candidates records instead.
 const unknown=await measure(['batch','--plan','claude-desktop:1','--dry']);
 assert.equal((unknown.json.planParts as Array<{known:boolean}>)[0]!.known,false);
 // Argument errors are still errors.
 await assert.rejects(measure(['batch','--plan','claude:0','--dry']));
 await assert.rejects(measure(['batch','--dry']));
});

test('footprint targets node processes running this repository src/*.ts, wherever the option sits, and their children',()=>{
 const table=parseProcessTable([
  ` 101 1 node --enable-source-maps ${CLI} mcp`,
  ` 102 1 node ${join(REPO,'src','grok-hook.ts')}`,
  ` 103 1 curl https://x/seamless/`,
  ` 104 1 node /other/src/cli.ts send`,
  ` 105 101 node ${CLI} status`,
  ` 106 101 /usr/bin/helper --child`,
  ` 107 1 node ${join(REPO,'scripts','measure.ts')} footprint`,
  ` 108 1 node /other/viewer.js ${CLI}`,
  ` 109 1 node /other/viewer.js ${join(REPO,'src','grok-hook.ts')}`,
  ` 110 1 node ${CLI} ${join(REPO,'src','grok-hook.ts')}`,
 ].join('\n'));
 const matched=seamlessProcesses(table);
 assert.deepEqual(matched,[101,102,105,110]);
 const scoped=descendants(matched,table).filter(pid=>pid!==process.pid);
 assert.ok(scoped.includes(106));
 for(const unrelated of [103,104,107,108,109])assert.equal(scoped.includes(unrelated),false);
 assert.equal(isSeamlessCli(`node --enable-source-maps ${CLI} mcp`),true);
 assert.equal(isSeamlessCli(`node ${join(REPO,'src','grok-hook.ts')}`),true);
 assert.equal(isSeamlessCli(`python3 ${CLI}`),false);
 assert.equal(isSeamlessCli(`node /other/src/cli.ts`),false);
 // The script path is the first argument after the node options; later arguments are not inspected.
 assert.equal(isSeamlessCli(`node /other/viewer.js ${CLI}`),false);
 assert.equal(isSeamlessCli(`node --enable-source-maps /other/viewer.js ${CLI}`),false);
});

test('footprint reports the process count, the store and inbox bytes, and a scoped connection count',async()=>{
 const {json}=await measure(['footprint']);
 assert.equal(json.status,'ok');
 const summary=json.summary as {processes:number;bytes:{store:number;inbox:number};connections:number|null};
 assert.equal(typeof summary.processes,'number');
 assert.equal(typeof summary.bytes.store,'number');
 assert.equal(typeof summary.bytes.inbox,'number');
 assert.ok(summary.connections===null||typeof summary.connections==='number');
});

test('batch default record names include milliseconds and pid and never overwrite each other',async()=>{
 const first=await measure(['batch','--plan','fake:1']);
 const second=await measure(['batch','--plan','fake:1']);
 const firstFile=String(first.json.recordFile),secondFile=String(second.json.recordFile);
 try{
  assert.notEqual(firstFile,secondFile);
  assert.match(basename(firstFile),/^batch-\d{17}-\d+\.jsonl$/);
  assert.equal((await readFile(firstFile,'utf8')).trim().split('\n').length,2);
  assert.equal((await readFile(secondFile,'utf8')).trim().split('\n').length,2);
 }finally{
  await rm(firstFile,{force:true});await rm(secondFile,{force:true});
 }
});

test('compare --dry prints the five metrics as an empty table',async()=>{
 const {json,stdout}=await measure(['compare','--dry']);
 assert.equal(json.status,'ok');assert.equal(json.dry,true);
 const metrics=json.metrics as Array<{metric:string;value:null;samples:number}>;
 assert.deepEqual(metrics.map(m=>m.metric),['first_screen_seconds','first_roundtrip_seconds','operations','resume_success','display_accuracy']);
 assert.ok(metrics.every(m=>m.value===null&&m.samples===0));
 assert.ok(stdout.includes('指標'));
});
