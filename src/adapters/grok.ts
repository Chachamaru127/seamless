import {lstat,readdir,readFile,realpath} from 'node:fs/promises';
import {homedir} from 'node:os';
import {basename,join} from 'node:path';
import {isVersionAllowed,type CompatibilityOptions} from '../compat.ts';
import {processStart,readOwned} from './claude.ts';
import type {Registration} from '../protocol.ts';
import type {ReadItem,Transcript,TranscriptReader} from './read.ts';
// Grok Build CLI keeps its own ledger of running TUI conversations (~/.grok/active_sessions.json): the TUI adds a row
// when it opens a conversation and removes it on exit (measured 2026-10-08, Grok CLI 1.0.46). Headless runs (grok -p)
// are never in it. A row is trusted only while its pid is alive and started when the row says.
export type GrokRow={session_id:string;pid:number;cwd:string;opened_at:string};
export type GrokOptions=CompatibilityOptions&{home?:string;processStart?:(pid:number)=>Promise<number|null>;grokVersion?:()=>Promise<string|null>};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_LEDGER_BYTES=1_048_576,MAX_SUMMARY_BYTES=65_536,MAX_UPDATES_BYTES=64*1024*1024;
const OMITTED=['thoughts','chat_history','tool_inputs','tool_results','hook_executions'];
function row(v:any):v is GrokRow{return !!v&&typeof v==='object'&&typeof v.session_id==='string'&&UUID.test(v.session_id)&&Number.isSafeInteger(v.pid)&&v.pid>0&&typeof v.cwd==='string'&&v.cwd.startsWith('/')&&typeof v.opened_at==='string'&&Number.isFinite(Date.parse(v.opened_at));}
// null = the ledger could not be read safely; [] = no running TUI conversation. One row of another shape (a missing
// working directory, say) makes the whole ledger unreadable: dropping only that row would turn its conversation into a
// stopped one, listed with the workspace its folder name suggests.
export async function readGrokLedger(home=homedir()):Promise<GrokRow[]|null>{
 const raw=await readOwned(join(home,'.grok','active_sessions.json'),MAX_LEDGER_BYTES);
 if('error' in raw)return raw.error==='missing'?[]:null;
 try{const v=JSON.parse(raw.text);return Array.isArray(v)&&v.every(row)?v:null;}catch{return null;}
}
export const grokGeneration=(r:Pick<GrokRow,'pid'|'opened_at'>)=>`${r.pid}@${r.opened_at}`;
// A row is live while its pid runs a process that started no later than the row (ps reports the start to the second, so
// one second of slack). A reused pid belongs to a process started after the row and fails this. There is no lower bound:
// a TUI can open a conversation long after it started (measured 9 s; /new and /resume open one later still).
export async function grokRowAlive(r:GrokRow,options:GrokOptions={}):Promise<boolean>{
 const started=await (options.processStart??processStart)(r.pid),opened=Date.parse(r.opened_at);
 return started!==null&&started<=opened+1000;
}
// The installed version is in the file name the launcher points to (~/.grok/bin/grok -> ../downloads/grok-<version>-macos-<arch>).
export async function grokVersion(home=homedir()):Promise<string|null>{
 try{const m=/^grok-(\d+\.\d+\.\d+)-/.exec(basename(await realpath(join(home,'.grok','bin','grok'))));return m?m[1]:null;}catch{return null;}
}
export type GrokIdentity={version:string|null;nativeId:string;generation:string;cwd:string;socket:string;pid:number};
// The running conversation, or null when it is not running, is ambiguous (two live processes), or its workspace is gone.
export async function grokIdentity(nativeId:string,options:GrokOptions={},generation?:string):Promise<GrokIdentity|null>{
 const home=options.home??homedir(),rows=await readGrokLedger(home);if(!rows)return null;
 const live=[];for(const r of rows)if(r.session_id===nativeId&&(generation===undefined||grokGeneration(r)===generation)&&await grokRowAlive(r,options))live.push(r);
 if(live.length!==1)return null;
 const r=live[0],version=await (options.grokVersion??(()=>grokVersion(home)))();
 if(!isVersionAllowed('grok',version,options))return null;
 try{return {version,nativeId,generation:grokGeneration(r),cwd:await realpath(r.cwd),socket:'',pid:r.pid};}catch{return null;}
}
// Conversation folders are named by the URL-encoded workspace. The name is decoded for the scope check only.
export async function grokSessionDirs(home=homedir()):Promise<{cwd:string;dir:string}[]>{
 const root=join(home,'.grok','sessions');let names:string[]=[];try{names=await readdir(root);}catch{return [];}
 return names.flatMap(name=>{try{const cwd=decodeURIComponent(name);return cwd.startsWith('/')?[{cwd,dir:join(root,name)}]:[];}catch{return [];}});
}
export type GrokSummary={id:string;cwd:string;kind:string|null;lastActive:number};
export async function grokSummary(dir:string,id:string):Promise<GrokSummary|null>{
 if(!UUID.test(id))return null;
 const raw=await readOwned(join(dir,id,'summary.json'),MAX_SUMMARY_BYTES);if('error' in raw)return null;
 try{const v=JSON.parse(raw.text);if(v?.info?.id!==id||typeof v.info.cwd!=='string')return null;
  // A TUI conversation has no session_kind; headless runs say headless and delegated work says subagent (measured 2026-10-08).
  const kind=Object.hasOwn(v,'session_kind')?String(v.session_kind):null,last=Date.parse(v.last_active_at??v.updated_at??'');
  return {id,cwd:v.info.cwd,kind,lastActive:Number.isFinite(last)?last:0};}catch{return null;}
}
export async function findGrokSessionDir(nativeId:string,home=homedir(),cwd?:string):Promise<string|null>{
 if(!UUID.test(nativeId))return null;
 const root=join(home,'.grok','sessions');
 const direct=cwd?join(root,encodeURIComponent(cwd),nativeId):null;
 if(direct&&await lstat(direct).then(s=>s.isDirectory(),()=>false))return direct;
 for(const {dir} of await grokSessionDirs(home)){const path=join(dir,nativeId);if(await lstat(path).then(s=>s.isDirectory()&&!s.isSymbolicLink(),()=>false))return path;}
 return null;
}
// Visible conversation only: user and agent message chunks joined into one item per turn segment, and the name of each
// tool call. Thoughts, tool inputs and outputs, hook runs and the raw model history (chat_history.jsonl) are not read.
export function projectGrok(lines:string[],nativeId:string):ReadItem[]{
 const items:ReadItem[]=[];let open:{item:ReadItem;prompt:string|null}|null=null;
 for(const line of lines){
  if(!line.trim())continue;let j;try{j=JSON.parse(line);}catch{continue;}
  const p=j?.params,u=p?.update;if(!u||p.sessionId!==nativeId)continue;
  const kind=u.sessionUpdate,meta=p._meta??{},at=Number.isFinite(meta.agentTimestampMs)?new Date(meta.agentTimestampMs).toISOString():Number.isFinite(j.timestamp)?new Date(j.timestamp*1000).toISOString():null;
  const id=typeof meta.eventId==='string'?meta.eventId:`${nativeId}:${items.length}`;
  if(kind==='user_message_chunk'||kind==='agent_message_chunk'){
   const text=u.content?.type==='text'&&typeof u.content.text==='string'?u.content.text:null;if(text===null)continue;
   const role=kind==='user_message_chunk'?'user':'assistant',prompt=typeof meta.promptId==='string'?meta.promptId:null;
   if(open&&open.item.role===role&&open.prompt===prompt){open.item.text+=text;continue;}
   const item:ReadItem={nativeItemId:id,role,text,at};items.push(item);open={item,prompt};continue;
  }
  if(kind==='tool_call'){items.push({nativeItemId:id,role:'tool',text:typeof u.title==='string'?u.title:'tool',at});open=null;continue;}
  if(kind==='turn_completed')open=null;
 }
 return items;
}
export function createGrokReader(options:GrokOptions={}):TranscriptReader{
 return async(target:Registration)=>{
  if(target.provider!=='grok')return {status:'unavailable',reason:'provider'};
  const home=options.home??homedir(),n=await grokIdentity(target.nativeId,options);
  if(!n)return {status:'not_found',reason:'grok_not_running'};
  const dir=await findGrokSessionDir(target.nativeId,home,n.cwd);if(!dir)return {status:'not_found',reason:'grok_session_folder'};
  const raw=await readOwned(join(dir,'updates.jsonl'),MAX_UPDATES_BYTES);
  if('error' in raw)return raw.error==='missing'?{status:'not_found',reason:'grok_updates'}:{status:'unavailable',reason:'grok_updates_unreadable'};
  return {generation:n.generation,items:projectGrok(raw.text.split('\n'),target.nativeId),complete:true,source:'grok-updates',omitted:OMITTED} satisfies Transcript;
 };
}
export const grokSessionsRoot=(home=homedir())=>join(home,'.grok','sessions');
export const SEAMLESS_ENVELOPE_MARK='--- seamless の封筒（機械用） ---';
function annotatedEnvelope(message:string):{id:string;sender:{provider:string;nativeId:string};replyTo?:string}|null{
 const at=message.lastIndexOf(SEAMLESS_ENVELOPE_MARK);if(at<0)return null;
 const line=message.slice(at+SEAMLESS_ENVELOPE_MARK.length).trim().split('\n')[0];
 try{const e=JSON.parse(line);if(e?.schemaVersion!==1||typeof e.id!=='string'||typeof e.sender?.id!=='string'||typeof e.sender?.nativeId!=='string')return null;
  return {id:e.id,sender:{provider:e.sender.id.split(':')[0],nativeId:e.sender.nativeId},...(typeof e.replyTo==='string'?{replyTo:e.replyTo}:{})};}catch{return null;}
}
// What the status of a request to a Grok CLI conversation is read from: the hook's receipts in seamless's inbox, and from
// Grok's own record the user turns, the agent's messages and tool calls, and each Stop's hook runs (names that succeeded).
export async function readGrokStructure(target:Registration,options:GrokOptions={}):Promise<import('../status.ts').StructureItem[]>{
 const home=options.home??homedir(),inbox=await import('../grok-inbox.ts'),items:import('../status.ts').StructureItem[]=[];
 for(const r of await inbox.receipts(home,target.nativeId)){
  const sender=r.envelope.sender;
  items.push({id:'receipt:'+inbox.keyOf(r.envelope.sender,r.envelope.id),type:'grok-receipt',at:new Date(r.hookAt).toISOString(),generation:r.generation,hookName:r.hookName,peer:{id:r.envelope.id,sender:{provider:sender.id.split(':')[0],nativeId:sender.nativeId},...(r.envelope.replyTo?{replyTo:r.envelope.replyTo}:{})}});
 }
 const dir=await findGrokSessionDir(target.nativeId,home,target.workspace);
 if(dir){
  const raw=await readOwned(join(dir,'updates.jsonl'),MAX_UPDATES_BYTES);
  if('text' in raw){
   let last='';
   for(const line of raw.text.split('\n').slice(-4000)){
    if(!line.trim())continue;let j;try{j=JSON.parse(line);}catch{continue;}
    const p=j?.params,u=p?.update;if(!u||p.sessionId!==target.nativeId)continue;
    const meta=p._meta??{},at=Number.isFinite(meta.agentTimestampMs)?new Date(meta.agentTimestampMs).toISOString():Number.isFinite(j.timestamp)?new Date(j.timestamp*1000).toISOString():null;
    const id=typeof meta.eventId==='string'?meta.eventId:`${target.nativeId}:${items.length}`,kind=u.sessionUpdate;
    // One item per run of chunks of the same speaker, like the read projection.
    if(kind==='user_message_chunk'||kind==='agent_message_chunk'){const type=kind==='user_message_chunk'?'user':'assistant';if(last!==type)items.push({id,type,at});last=type;continue;}
    if(kind==='tool_call'){items.push({id,type:'tool',at});last='tool';continue;}
    // What a Stop hook handed over is recorded as a hook_annotation right after that Stop: "↩ Stop hook feedback, continuing: "
    // and the whole text (measured 2026-10-08). seamless's text ends with its envelope as one JSON line; its request id is read from there.
    if(kind==='hook_annotation'&&typeof u.message==='string'&&u.message.includes(SEAMLESS_ENVELOPE_MARK)){const peer=annotatedEnvelope(u.message);if(peer)items.push({id,type:'hook_note',at,peer});continue;}
    if(kind==='hook_execution'&&u.event_name==='stop'){items.push({id,type:'hook_stop',at,hooks:(Array.isArray(u.runs)?u.runs:[]).filter((r:any)=>r?.status?.status==='success'&&typeof r.name==='string').map((r:any)=>r.name)});last='hook';continue;}
    if(kind==='turn_completed')last='';
   }
  }
 }
 return items.filter(n=>n.at!==null).sort((a,b)=>Date.parse(a.at!)-Date.parse(b.at!));
}
// Envelopes this conversation (this generation) was handed by its hook: what it has received. A delivered request keeps
// its metadata (id, parties, replyTo) but not its body, so text is always empty here (spec.md, "持たないもの").
export async function grokInbound(recipient:Registration,options:GrokOptions={}){
 const home=options.home??homedir(),inbox=await import('../grok-inbox.ts');
 return (await inbox.receipts(home,recipient.nativeId)).filter(r=>r.generation===recipient.generation).map(r=>({id:r.envelope.id,sender:r.envelope.sender,recipient:r.envelope.recipient,text:'',...(r.envelope.replyTo?{replyTo:r.envelope.replyTo}:{})}));
}
export async function grokReceived(target:Registration,options:GrokOptions={}){
 const home=options.home??homedir(),inbox=await import('../grok-inbox.ts');
 return (await inbox.receipts(home,target.nativeId)).filter(r=>r.generation===target.generation).map(r=>({id:r.envelope.id,sender:r.envelope.sender,recipient:r.envelope.recipient,at:new Date(r.hookAt).toISOString()}));
}
// Ids of seamless sends this conversation made to a recipient, from its own record of tool calls. Only the requested ids
// leave this function.
export async function readGrokSentIds(target:Registration,ids:string[],recipient:Pick<Registration,'provider'|'nativeId'>,options:GrokOptions={}):Promise<string[]>{
 const home=options.home??homedir(),dir=await findGrokSessionDir(target.nativeId,home,target.workspace);if(!dir)return [];
 const raw=await readOwned(join(dir,'updates.jsonl'),MAX_UPDATES_BYTES);if(!('text' in raw))return [];
 const {sentTo}=await import('../inbound.ts'),found=new Set<string>();
 for(const line of raw.text.split('\n')){
  if(!line.includes('"tool_call"'))continue;let j;try{j=JSON.parse(line);}catch{continue;}
  const u=j?.params?.update;if(j?.params?.sessionId!==target.nativeId||u?.sessionUpdate!=='tool_call')continue;
  // Grok calls an MCP tool through its own use_tool wrapper: rawInput {tool_name: "seamless__send", tool_input: {...}}
  // (measured 2026-10-08 in T1-10a). A direct call names the tool in its metadata and title instead.
  const tool=u._meta?.['x.ai/tool']??{},raw=u.rawInput;
  const wrapped=raw&&typeof raw==='object'&&typeof raw.tool_name==='string'?{named:raw.tool_name,input:raw.tool_input}:{named:[tool.name,tool.namespace,u.title].filter(x=>typeof x==='string').join(' '),input:raw};
  if(!/seamless/.test(wrapped.named)||!/send/.test(wrapped.named))continue;
  const input=wrapped.input;if(input&&typeof input.id==='string'&&ids.includes(input.id)&&sentTo(input,recipient))found.add(input.id);
 }
 return [...found];
}
