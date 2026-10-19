// Measurement commands for specs/2026-10-universal-wiring (T15, Plans.md 8 章).
// A measurement never writes the message body to a record: the reservation keeps a hash, and these records keep ids,
// stages, state and timings only. `roundtrip` and `hold` accept a fake peer so the shape can be checked without a
// running product; `batch --plan fake:2` does the same for the record file. Real targets go through the CLI (src/cli.ts),
// which identifies the caller from an ancestor as usual.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {appendFile,mkdir,mkdtemp,readFile,readdir,lstat,rm,writeFile} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {Delivery,type NativeAdapter} from '../src/delivery.ts';
import {Registry} from '../src/registry.ts';
import {createStatus,type StatusClock,type StructureItem} from '../src/status.ts';
import type {Registration} from '../src/protocol.ts';
import type {RequestParty} from '../src/request-store.ts';
import {DEFAULT_HELD_AFTER_SEC,heldAfterSec,readLimits} from '../src/limits.ts';

const REPO=join(dirname(fileURLToPath(import.meta.url)),'..');
const exec=promisify(execFile);

const USAGE=`seamless measure (T15)

使い方:
  node scripts/measure.ts roundtrip (--target <id> | --fake | --target fake:codex) [--wait <秒>] [--text <本文>] [--log <file>]
  node scripts/measure.ts hold (--target <id> | --fake | --target fake:codex) [--wait <秒>] [--held-after-sec <秒>] [--text <本文>] [--log <file>]
  node scripts/measure.ts batch --plan <名前:回数,...> [--out <file>] [--wait <秒>] [--text <本文>]
  node scripts/measure.ts footprint [--home <dir>]
  node scripts/measure.ts compare [--dry] [--file <記録ファイル>]

副コマンド:
  roundtrip  1 往復の依頼 ID と返信 ID の一致を JSON で出す
  hold       保留中 (held) と理由を出す（判定に使う待ち秒は --held-after-sec か limits）
  batch      計画に沿って複数回往復し、本文を含まない記録ファイルを作る
  footprint  seamless のプロセス数、保存先と受信箱のバイト数、seamless のプロセスに限った接続数を出す
  compare    5 指標の表を出す（--dry は空の表）

偽の相手: --fake は一時ディレクトリで本物の予約と段階判定を通す。実ホームの設定は読まず、本物の製品にも送らない。
本物の相手: src/cli.ts と同じ経路（作業中の会話から実行する）。--target は who --json の id。
`;

type FlagValue=string|boolean;
type Flags=Record<string,FlagValue>;
class MeasureError extends Error{code:string;constructor(code:string,message?:string){super(message??code);this.name='MeasureError';this.code=code;}}

function parseFlags(args:string[],values:readonly string[],booleans:readonly string[]):Flags{
 const out:Flags={};
 for(let i=0;i<args.length;i++){
  const arg=args[i]!;
  if(!arg.startsWith('--'))throw new MeasureError('invalid_arguments',arg);
  const name=arg.slice(2);
  if(booleans.includes(name)){if(out[name]!==undefined)throw new MeasureError('invalid_arguments',arg);out[name]=true;continue;}
  if(!values.includes(name))throw new MeasureError('invalid_arguments',arg);
  const value=args[++i];
  if(value===undefined||value.startsWith('--'))throw new MeasureError('invalid_arguments',arg);
  if(out[name]!==undefined)throw new MeasureError('invalid_arguments',arg);
  out[name]=value;
 }
 return out;
}
const str=(flags:Flags,name:string):string|undefined=>typeof flags[name]==='string'?flags[name] as string:undefined;
const flag=(flags:Flags,name:string):boolean=>flags[name]===true;
const emit=(value:unknown)=>{console.log(JSON.stringify(value));};

// ---------- records (never the body) ----------
type StageRecord={stage:string;status:string;evidenceCount:number};
type MeasureRecord={kind:string;id:string;target:string;at:string;mode:'fake'|'real';delivery?:string;stages?:StageRecord[];state?:string;reason?:string;replyId?:string|null;match?:boolean;seconds?:number;operations?:number;falseReached?:boolean;error?:string};
function stamp():string{return new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14);}
function defaultRecordFile(kind:string,fake:boolean):string{
 return fake?join(REPO,'out','measure',`${kind}-${stamp()}.jsonl`):join(homedir(),'.seamless','measurements',`${kind}-${stamp()}.jsonl`);
}
async function writeRecords(path:string,records:unknown[]):Promise<void>{
 await mkdir(dirname(path),{recursive:true,mode:0o700});
 await writeFile(path,records.map(r=>JSON.stringify(r)).join('\n')+'\n',{mode:0o600});
}
async function appendRecord(path:string,record:unknown):Promise<void>{
 await mkdir(dirname(path),{recursive:true,mode:0o700});
 await appendFile(path,JSON.stringify(record)+'\n',{mode:0o600});
}

// ---------- fake peer (real reservation + stage reader, no product) ----------
type FakeProvider='claude'|'codex';
type Tracked={status:string;delivery?:string;state?:string;reason?:string;stages?:Array<{stage:string;status:string;evidence:string[]}>};
function fakeProvider(value:string|undefined):FakeProvider{
 const name=(value??'claude').replace(/^fake:?/,'')||'claude';
 if(name==='claude'||name==='codex')return name;
 throw new MeasureError('invalid_arguments',`unknown fake provider: ${name}`);
}
function fakeTarget(flags:Flags):FakeProvider|undefined{
 const target=str(flags,'target');
 if(!target)return flag(flags,'fake')?'claude':undefined;
 if(target==='fake')return 'claude';
 if(target.startsWith('fake:'))return fakeProvider(target);
 return undefined;
}
function fakeRegistrations(provider:FakeProvider):{sender:Registration;recipient:Registration}{
 const senderId='fake:caller',recipientId='fake:peer';
 const both=(peer:string):Registration['grants']=>[
  {peer,operation:'read',direction:'inbound'},{peer,operation:'send',direction:'inbound'},
  {peer,operation:'read',direction:'outbound'},{peer,operation:'send',direction:'outbound'},
 ];
 const base={generation:'measure-g1',host:'local',workspace:'/measure',operations:['read','send'] as Registration['operations']};
 const sender:Registration={...base,id:senderId,provider:provider==='claude'?'codex':'claude',nativeId:'caller',displayName:senderId,grants:both(recipientId)};
 const recipient:Registration={...base,id:recipientId,provider,nativeId:'peer',displayName:recipientId,grants:both(senderId)};
 return {sender,recipient};
}
const party=(r:Registration):RequestParty=>({id:r.id,provider:r.provider,nativeId:r.nativeId,generation:r.generation,cwd:r.workspace});

type FakeOutcome={requestId:string;provider:FakeProvider;tracked:Tracked;replyId:string|null;match:boolean;seconds:number;operations:number;falseReached:boolean;at:string};
async function fakeRun(kind:'roundtrip'|'hold',provider:FakeProvider,text:string,holdSec:number):Promise<FakeOutcome>{
 const home=await mkdtemp(join(tmpdir(),'seamless-measure-'));
 const started=Date.now(),at=new Date(started).toISOString(),requestId=`measure-${randomUUID()}`,replyId=`reply-${randomUUID()}`;
 const {sender,recipient}=fakeRegistrations(provider);
 try{
  const adapter:NativeAdapter={
   read:async()=>({status:'ok'}),
   structure:async(target:Registration):Promise<StructureItem[]>=>{
    if(kind==='hold')return [];
    if(target.id===recipient.id)return [
     {id:`peer-${requestId}`,type:'user',at,peer:{id:requestId,sender:{provider:sender.provider,nativeId:sender.nativeId}}},
     {id:`processing-${requestId}`,type:'assistant',at,parentUuid:`peer-${requestId}`},
    ];
    return [{id:replyId,type:'assistant',at,peer:{id:replyId,replyTo:requestId,sender:{provider:recipient.provider,nativeId:recipient.nativeId}}}];
   },
   send:async()=>({status:'submitted'}),
  };
  const delivery=new Delivery(new Registry([sender,recipient]),sender.id,adapter,{tracking:{keyPath:join(home,'key')},fixedTarget:recipient,reservationDir:join(home,'reservations')});
  const sent=await delivery.send({target:recipient.id,id:requestId,text}) as {status?:string};
  const clock:StatusClock={now:()=>kind==='hold'?started+holdSec*1000+5000:Date.now(),sleep:async()=>{}};
  const status=createStatus({dir:join(home,'reservations'),adapter,caller:party(sender),canRead:async()=>true,clock,heldAfterSec:holdSec});
  const tracked=await status.track(requestId) as Tracked;
  const stages=tracked.stages??[];
  const replied=stages.find(s=>s.stage==='replied'&&s.status==='observed');
  const reached=stages.some(s=>['reached','processing','replied'].includes(s.stage)&&s.status==='observed');
  return {requestId,provider,tracked,replyId:replied?.evidence[0]??null,match:!!replied,seconds:Math.max(0,(Date.now()-started)/1000),operations:1,falseReached:reached&&sent.status!=='submitted',at};
 }finally{await rm(home,{recursive:true,force:true});}
}
function fakeRecord(outcome:FakeOutcome,kind:'roundtrip'|'hold',target:string):MeasureRecord{
 const stages=(outcome.tracked.stages??[]).map(s=>({stage:s.stage,status:s.status,evidenceCount:s.evidence.length}));
 return {kind,id:outcome.requestId,target,at:outcome.at,mode:'fake',...(outcome.tracked.delivery?{delivery:outcome.tracked.delivery}:{}),stages,...(outcome.tracked.state?{state:outcome.tracked.state}:{}),...(outcome.tracked.reason?{reason:outcome.tracked.reason}:{}),...((kind==='roundtrip')?{replyId:outcome.replyId,match:outcome.match}:{replyId:null}),seconds:outcome.seconds,operations:outcome.operations,falseReached:outcome.falseReached};
}

// ---------- real peer through the CLI ----------
async function cliJson(args:string[]):Promise<Record<string,unknown>>{
 const {stdout}=await exec(process.execPath,[join(REPO,'src','cli.ts'),...args],{maxBuffer:32*1024*1024,timeout:180000,env:process.env});
 const line=stdout.trim().split('\n').filter(Boolean).pop();
 if(!line)throw new MeasureError('cli_empty');
 const value:unknown=JSON.parse(line);
 if(!value||typeof value!=='object'||Array.isArray(value))throw new MeasureError('cli_unexpected');
 return value as Record<string,unknown>;
}
type Candidate={id:string;provider:string;ticket:string|null};
function candidatesOf(listed:Record<string,unknown>):Candidate[]{
 const out:Candidate[]=[];
 const add=(value:unknown)=>{
  if(!Array.isArray(value))return;
  for(const item of value)if(item&&typeof item==='object'){
   const v=item as Record<string,unknown>;
   if(typeof v.id==='string')out.push({id:v.id,provider:typeof v.provider==='string'?v.provider:typeof v.product==='string'?v.product:'',ticket:typeof v.ticket==='string'?v.ticket:null});
  }
 };
 add(listed.candidates);add(listed.external);
 return out;
}
function stageRecords(value:unknown):StageRecord[]{
 if(!Array.isArray(value))return [];
 return value.flatMap(item=>{
  if(!item||typeof item!=='object')return [];
  const v=item as Record<string,unknown>;
  if(typeof v.stage!=='string'||typeof v.status!=='string')return [];
  return [{stage:v.stage,status:v.status,evidenceCount:Array.isArray(v.evidence)?v.evidence.length:0}];
 });
}
async function realSendAndTrack(candidate:Candidate,kind:'roundtrip'|'hold',text:string,waitSeconds:number):Promise<MeasureRecord>{
 const started=Date.now(),requestId=`measure-${randomUUID()}`,target=candidate.id;
 const at=new Date(started).toISOString();
 if(!candidate.ticket)return {kind,id:requestId,target,at,mode:'real',match:false,error:'target_unavailable',operations:1};
 const sent=await cliJson(['send',JSON.stringify({ticket:candidate.ticket,id:requestId,text})]);
 const delivery=typeof sent.status==='string'?sent.status:'unknown';
 if(!['submitted','unknown'].includes(delivery))return {kind,id:requestId,target,at,mode:'real',delivery,match:false,error:delivery,operations:1};
 const status=await cliJson(['status',requestId,'--wait',String(waitSeconds)]);
 const rawStages=Array.isArray(status.stages)?status.stages:[];
 const repliedStage=rawStages.find(item=>isObject(item)&&item.stage==='replied'&&item.status==='observed');
 const replyId=isObject(repliedStage)&&Array.isArray(repliedStage.evidence)&&typeof repliedStage.evidence[0]==='string'?repliedStage.evidence[0]:null;
 const stages=stageRecords(status.stages);
 const replied=!!repliedStage;
 const reached=stages.some(s=>['reached','processing','replied'].includes(s.stage)&&s.status==='observed');
 return {kind,id:requestId,target,at,mode:'real',delivery:typeof status.delivery==='string'?status.delivery:delivery,stages,...(typeof status.state==='string'?{state:status.state}:{}),...(typeof status.reason==='string'?{reason:status.reason}:{}),...(kind==='roundtrip'?{replyId,match:replied}:{replyId:null}),seconds:Math.max(0,(Date.now()-started)/1000),operations:1,falseReached:reached&&delivery!=='submitted'};
}
async function listCandidates():Promise<Candidate[]>{
 const listed=await cliJson(['sessions',JSON.stringify({operation:'send',scope:'any'})]);
 if(listed.status!=='ok')throw new MeasureError(typeof listed.status==='string'?listed.status:'sessions_failed');
 return candidatesOf(listed);
}
async function realRoundtrip(target:string,text:string,waitSeconds:number):Promise<MeasureRecord>{
 const all=await listCandidates();
 const candidate=all.find(c=>c.id===target);
 if(!candidate)return {kind:'roundtrip',id:`measure-${randomUUID()}`,target,at:new Date().toISOString(),mode:'real',match:false,error:'target_unavailable',operations:1};
 return realSendAndTrack(candidate,'roundtrip',text,waitSeconds);
}
async function realHold(target:string,text:string,holdSec:number):Promise<MeasureRecord>{
 const all=await listCandidates();
 const candidate=all.find(c=>c.id===target);
 if(!candidate)return {kind:'hold',id:`measure-${randomUUID()}`,target,at:new Date().toISOString(),mode:'real',error:'target_unavailable',operations:1};
 return realSendAndTrack(candidate,'hold',text,Math.min(600,holdSec+2));
}
function providerMatches(name:string,candidate:Candidate):boolean{
 if(name==='claude')return candidate.provider==='claude';
 if(name==='codex'||name==='codex-cli'||name==='codex-desktop')return candidate.provider==='codex';
 if(name==='grok')return candidate.provider==='grok';
 if(name==='grok-bot')return candidate.provider==='grok-bot';
 return false;
}

// ---------- batch plan ----------
type PlanEntry={name:string;count:number};
function parsePlan(plan:string):PlanEntry[]{
 const out:PlanEntry[]=[];
 for(const raw of plan.split(',')){
  const item=raw.trim();if(!item)continue;
  const match=/^([a-z0-9-]+)(?::(\d{1,3}))?$/.exec(item);
  if(!match)throw new MeasureError('invalid_arguments',`plan: ${item}`);
  const count=match[2]===undefined?1:Number(match[2]);
  if(!Number.isInteger(count)||count<1||count>100)throw new MeasureError('invalid_arguments',`plan: ${item}`);
  out.push({name:match[1]!,count});
 }
 if(!out.length)throw new MeasureError('invalid_arguments','plan');
 return out;
}
async function runBatch(plan:string,outPath:string|undefined,text:string,waitSeconds:number):Promise<{recordFile:string;entries:MeasureRecord[];falseReached:number}>{
 const entries=parsePlan(plan),records:MeasureRecord[]=[];
 const fakeOnly=entries.every(e=>e.name==='fake');
 const all=fakeOnly?[]:await listCandidates();
 for(const entry of entries){
  if(entry.name==='fake'){
   for(let i=0;i<entry.count;i++)records.push(fakeRecord(await fakeRun('roundtrip','claude',text,20),'roundtrip','fake'));
   continue;
  }
  const pool=all.filter(c=>providerMatches(entry.name,c));
  if(!pool.length){
   for(let i=0;i<entry.count;i++)records.push({kind:'roundtrip',id:`measure-${randomUUID()}`,target:entry.name,at:new Date().toISOString(),mode:'real',match:false,error:'no_candidates',operations:1});
   continue;
  }
  for(let i=0;i<entry.count;i++)records.push(await realSendAndTrack(pool[i%pool.length]!,'roundtrip',text,waitSeconds));
 }
 const path=outPath??defaultRecordFile('batch',fakeOnly);
 const summary={kind:'batch',plan,at:new Date().toISOString(),entries:records.length,falseReached:records.filter(r=>r.falseReached===true).length,mode:fakeOnly?'fake':'real'};
 await writeRecords(path,[summary,...records]);
 return {recordFile:path,entries:records,falseReached:summary.falseReached};
}

// ---------- footprint ----------
export type Proc={pid:number;ppid:number;command:string};
export function parseProcessTable(stdout:string):Proc[]{
 const out:Proc[]=[];
 for(const line of stdout.split('\n')){
  const match=/^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
  if(match)out.push({pid:Number(match[1]),ppid:Number(match[2]),command:match[3]!});
 }
 return out;
}
async function processTable():Promise<Proc[]>{
 const {stdout}=await exec('ps',['-axo','pid=,ppid=,command='],{maxBuffer:16*1024*1024,timeout:15000});
 return parseProcessTable(stdout);
}
function cliScriptPath():string{return join(REPO,'src','cli.ts');}
function realPath(path:string):string{try{return realpathSync(path);}catch{return resolve(path);}}
// A seamless process is a node process whose second argument is this repository's src/cli.ts. Matching the command text
// for "seamless" would also count curl, editors and any other command that merely names the folder.
export function isSeamlessCli(command:string,cliPath=cliScriptPath()):boolean{
 const tokens=command.trim().split(/\s+/);
 if(tokens.length<2)return false;
 if(!/^node(?:js)?$/.test(basename(tokens[0]!)))return false;
 return realPath(tokens[1]!)===realPath(cliPath);
}
export function seamlessProcesses(table:Proc[],cliPath=cliScriptPath()):number[]{
 return table.filter(p=>p.pid!==process.pid&&isSeamlessCli(p.command,cliPath)).map(p=>p.pid);
}
export function descendants(pids:number[],table:Proc[]):number[]{
 const children=new Map<number,number[]>();
 for(const p of table){const list=children.get(p.ppid);if(list)list.push(p.pid);else children.set(p.ppid,[p.pid]);}
 const seen=new Set<number>(),queue=[...pids];
 while(queue.length){const pid=queue.shift()!;if(seen.has(pid))continue;seen.add(pid);for(const child of children.get(pid)??[])if(!seen.has(child))queue.push(child);}
 return [...seen];
}
async function bytesUnder(path:string):Promise<{bytes:number;exists:boolean}>{
 let root;try{root=await lstat(path);}catch{return {bytes:0,exists:false};}
 if(root.isSymbolicLink())return {bytes:0,exists:true};
 if(!root.isDirectory())return {bytes:root.isFile()?root.size:0,exists:true};
 let bytes=0;
 const walk=async(dir:string):Promise<void>=>{
  let names:string[]=[];try{names=await readdir(dir);}catch{return;}
  for(const name of names){
   const child=join(dir,name);let info;try{info=await lstat(child);}catch{continue;}
   if(info.isSymbolicLink())continue;
   if(info.isDirectory())await walk(child);
   else if(info.isFile())bytes+=info.size;
  }
 };
 await walk(path);
 return {bytes,exists:true};
}
async function connectionCount(pids:number[]):Promise<{count:number|null;available:boolean}>{
 if(!pids.length)return {count:0,available:true};
 try{
  const {stdout}=await exec('lsof',['-nP','-i','-a','-p',pids.join(',')],{maxBuffer:16*1024*1024,timeout:20000});
  const lines=stdout.split('\n').filter(Boolean);
  return {count:Math.max(0,lines.length-1),available:true};
 }catch(error){
  const failure=error as {code?:number|string;stdout?:string};
  if(failure.code===1)return {count:0,available:true};
  return {count:null,available:false};
 }
}
async function footprint(home:string){
 const table=await processTable();
 const matched=seamlessProcesses(table);
 const scoped=descendants(matched,table).filter(pid=>pid!==process.pid);
 const store=await bytesUnder(join(home,'.seamless'));
 const inboxCandidates=[join(home,'.seamless','grok-inbox'),join(home,'.grok','seamless-inbox'),join(home,'.cursor','seamless-inbox'),join(home,'.antigravity','seamless-inbox')];
 const inboxes=[];let inboxBytes=0;
 for(const path of inboxCandidates){const found=await bytesUnder(path);if(found.exists){inboxes.push({path,bytes:found.bytes});inboxBytes+=found.bytes;}}
 const connections=await connectionCount(scoped);
 return {status:'ok',at:new Date().toISOString(),summary:{processes:matched.length,bytes:{store:store.bytes,inbox:inboxBytes},connections:connections.count},processes:{count:matched.length,pids:matched},store:{path:join(home,'.seamless'),bytes:store.bytes},inbox:{bytes:inboxBytes,paths:inboxes},connections:{count:connections.count,available:connections.available,pids:scoped,scope:'seamless processes and their children'}};
}

// ---------- compare ----------
type Metric={metric:string;label:string;value:number|null;samples:number;matches?:number;attempts?:number};
const METRICS=[['first_screen_seconds','最初の画面までの時間'],['first_roundtrip_seconds','初回往復時間'],['operations','操作回数'],['resume_success','既存会話への復帰成功率'],['display_accuracy','届いた表示の正確さ']] as const;
function emptyMetrics():Metric[]{return METRICS.map(([metric,label])=>({metric,label,value:null,samples:0,...(metric==='resume_success'?{matches:0,attempts:0}:{})}));}
function metricTable(metrics:Metric[]):string{
 const shown=(m:Metric)=>m.metric==='resume_success'?`${m.matches??0}/${m.attempts??0}`:m.value===null?'':String(m.value);
 return ['指標\t値\t件数',...metrics.map(m=>`${m.label}\t${shown(m)}\t${m.samples}`)].join('\n');
}
function isObject(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
async function readRecords(path:string):Promise<Record<string,unknown>[]>{
 let raw:string;try{raw=await readFile(path,'utf8');}catch{return [];}
 const trimmed=raw.trim();if(!trimmed)return [];
 if(trimmed.startsWith('[')){try{const value:unknown=JSON.parse(trimmed);return Array.isArray(value)?value.filter(isObject):[];}catch{return [];}}
 const out:Record<string,unknown>[]=[];
 for(const line of trimmed.split('\n')){
  if(!line.trim())continue;
  try{const value:unknown=JSON.parse(line);if(isObject(value))out.push(value);}catch{}
 }
 return out;
}
function average(values:number[]):{value:number|null;samples:number}{return values.length?{value:values.reduce((a,b)=>a+b,0)/values.length,samples:values.length}:{value:null,samples:0};}
function compareMetrics(records:Record<string,unknown>[]):Metric[]{
 // `compare --file` reads JSON lines. Kinds: first_screen (seconds), roundtrip (seconds, operations),
 // resume (match, one per attempt) and display (correct, one per display). Roundtrip and hold records written by
 // this script have no body.
 const metrics=emptyMetrics();
 const find=(name:string)=>metrics.find(m=>m.metric===name)!;
 const firstScreen=average(records.filter(r=>r.kind==='first_screen'&&typeof r.seconds==='number').map(r=>r.seconds as number));
 Object.assign(find('first_screen_seconds'),firstScreen);
 const roundtrip=average(records.filter(r=>r.kind==='roundtrip'&&typeof r.seconds==='number').map(r=>r.seconds as number));
 Object.assign(find('first_roundtrip_seconds'),roundtrip);
 const operations=average(records.filter(r=>r.kind==='roundtrip'&&typeof r.operations==='number').map(r=>r.operations as number));
 Object.assign(find('operations'),operations);
 const resume=records.filter(r=>r.kind==='resume'&&typeof r.match==='boolean');
 const resumeMetric=find('resume_success');
 resumeMetric.matches=resume.filter(r=>r.match===true).length;resumeMetric.attempts=resume.length;resumeMetric.samples=resume.length;
 resumeMetric.value=resume.length?resumeMetric.matches/resume.length:null;
 const display=records.filter(r=>r.kind==='display'&&typeof r.correct==='boolean');
 const displayMetric=find('display_accuracy');
 displayMetric.matches=display.filter(r=>r.correct===true).length;displayMetric.attempts=display.length;displayMetric.samples=display.length;
 displayMetric.value=display.length?displayMetric.matches/display.length:null;
 return metrics;
}

// ---------- commands ----------
async function commandRoundtrip(args:string[]):Promise<number>{
 const flags=parseFlags(args,['target','wait','text','log'],['fake']);
 const provider=fakeTarget(flags);
 const waitRaw=str(flags,'wait');
 const wait=waitRaw===undefined?30:Number(waitRaw);
 if(!Number.isFinite(wait)||wait<0||wait>600)throw new MeasureError('invalid_arguments','--wait');
 const text=str(flags,'text')??'seamless measurement: reply with any short line.';
 const started=Date.now();
 let record:MeasureRecord;
 if(provider){
  const outcome=await fakeRun('roundtrip',provider,text,20);
  record=fakeRecord(outcome,'roundtrip',flag(flags,'fake')?'fake':`fake:${provider}`);
 }else{
  const target=str(flags,'target');
  if(!target)throw new MeasureError('invalid_arguments','--target or --fake');
  record=await realRoundtrip(target,text,wait);
 }
 record.seconds=Math.max(0,(Date.now()-started)/1000);
 const log=str(flags,'log');
 if(log)await appendRecord(log,record);
 else if(record.mode==='real')await appendRecord(join(homedir(),'.seamless','measurements','measure.jsonl'),record);
 emit({status:'ok',command:'roundtrip',requestId:record.id,target:record.target,mode:record.mode,delivery:record.delivery??null,replyId:record.replyId??null,match:record.match===true,seconds:record.seconds,operations:record.operations??1,state:record.state??null,reason:record.reason??null,stages:record.stages??[],falseReached:record.falseReached===true,...(record.error?{error:record.error}:{})});
 return record.error?1:0;
}
async function commandHold(args:string[]):Promise<number>{
 const flags=parseFlags(args,['target','wait','text','log','held-after-sec'],['fake']);
 const provider=fakeTarget(flags);
 const text=str(flags,'text')??'seamless measurement: hold check.';
 const injected=str(flags,'held-after-sec');
 let holdSec=DEFAULT_HELD_AFTER_SEC;
 if(injected!==undefined){holdSec=Number(injected);if(!Number.isInteger(holdSec)||holdSec<1||holdSec>3600)throw new MeasureError('invalid_arguments','--held-after-sec');}
 let record:MeasureRecord;
 if(provider){
  // A fake measurement never opens the real home: the wait used by the record is the wait used by the stage reader.
  const outcome=await fakeRun('hold',provider,text,holdSec);
  record=fakeRecord(outcome,'hold',`fake:${provider}`);
 }else{
  const target=str(flags,'target');
  if(!target)throw new MeasureError('invalid_arguments','--target or --fake');
  if(injected===undefined){const limits=await readLimits();holdSec=heldAfterSec(limits.status==='ok'?limits.value:{});}
  const waitRaw=str(flags,'wait');
  record=await realHold(target,text,waitRaw===undefined?holdSec:Number(waitRaw));
 }
 const log=str(flags,'log');
 if(log)await appendRecord(log,record);
 else if(record.mode==='real')await appendRecord(join(homedir(),'.seamless','measurements','measure.jsonl'),record);
 emit({status:'ok',command:'hold',requestId:record.id,target:record.target,mode:record.mode,delivery:record.delivery??null,state:record.state??null,reason:record.reason??null,stages:record.stages??[],...(record.error?{error:record.error}:{})});
 return record.error?1:0;
}
async function commandBatch(args:string[]):Promise<number>{
 const flags=parseFlags(args,['plan','out','wait','text'],[]);
 const plan=str(flags,'plan');
 if(!plan)throw new MeasureError('invalid_arguments','--plan');
 const waitRaw=str(flags,'wait');
 const wait=waitRaw===undefined?25:Number(waitRaw);
 if(!Number.isFinite(wait)||wait<0||wait>600)throw new MeasureError('invalid_arguments','--wait');
 const text=str(flags,'text')??'seamless measurement: batch check.';
 const result=await runBatch(plan,str(flags,'out'),text,wait);
 emit({status:'ok',command:'batch',plan,recordFile:result.recordFile,entries:result.entries.length,falseReached:result.falseReached,records:result.entries});
 return 0;
}
async function commandFootprint(args:string[]):Promise<number>{
 const flags=parseFlags(args,['home'],[]);
 const home=str(flags,'home')??homedir();
 emit(await footprint(home));
 return 0;
}
async function commandCompare(args:string[]):Promise<number>{
 const flags=parseFlags(args,['file'],['dry']);
 if(flag(flags,'dry')){const metrics=emptyMetrics();emit({status:'ok',command:'compare',dry:true,records:0,metrics,table:metricTable(metrics)});return 0;}
 const file=str(flags,'file')??join(homedir(),'.seamless','measurements','measure.jsonl');
 const records=await readRecords(file);
 const metrics=compareMetrics(records);
 emit({status:'ok',command:'compare',dry:false,file,records:records.length,metrics,table:metricTable(metrics)});
 return 0;
}

async function main(argv:string[]):Promise<number>{
 const [command,...args]=argv;
 if(command===undefined||command==='--help'||command==='-h'||command==='help'){process.stdout.write(USAGE);return 0;}
 if(!['roundtrip','hold','batch','footprint','compare'].includes(command)){process.stderr.write(`unknown command: ${command}\n`);process.stderr.write(USAGE);return 2;}
 if(args.includes('--help')){process.stdout.write(USAGE);return 0;}
 try{
  if(command==='roundtrip')return await commandRoundtrip(args);
  if(command==='hold')return await commandHold(args);
  if(command==='batch')return await commandBatch(args);
  if(command==='footprint')return await commandFootprint(args);
  return await commandCompare(args);
 }catch(error){
  const known=error instanceof MeasureError;
  emit({status:'error',command,error:{code:known?error.code:'failed',message:error instanceof Error?error.message:String(error)}});
  return known?2:1;
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 main(process.argv.slice(2)).then(code=>{process.exitCode=code;}).catch(error=>{process.stderr.write(`${error instanceof Error?error.message:String(error)}\n`);process.exitCode=1;});
}
