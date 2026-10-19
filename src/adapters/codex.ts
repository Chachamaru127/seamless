import {sentTo,type SendRecipient} from '../inbound.ts';
import type {StructureItem} from '../status.ts';
import {isVersionAllowed,type CompatibilityOptions} from '../compat.ts';
import { execFile } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { createConnection, type Socket } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { observeGit } from '../git-context.ts';
import type { Observation, Registration } from '../protocol.ts';
import { codexMessageMaxChars, type Limits } from '../limits.ts';
import type { Receipt } from '../delivery.ts';
import type { ReadFailure, ReadItem, TranscriptReader } from './read.ts';
import { parseEnvelope } from './read.ts';
import { readdir } from 'node:fs/promises';
const run=promisify(execFile);
// Desktop IPC is not a public SDK. Only versions whose owner snapshot and full-history read were measured.
export const CLIENT_TYPE='seamless-read';
export const PEER_NAMESPACES:readonly string[]=['seamless_test','seamless','claudex_test','claudex'];
const MAX_FRAME=256*1024*1024,STEP_MS=40_000;
const OMITTED=['reasoning','commandExecution','mcpToolCall','fileChange','webSearch','non_seamless_tool_output','images','subagents'];
export type CodexOptions=CompatibilityOptions&{codexHome?:string;socketPath?:string;version?:()=>Promise<string|null>;timeoutMs?:number;owner?:(nativeId:string)=>Promise<string|null>};
export type CodexSessionMeta={ownerId:string;cwd:string|null;generation:string;version:string};
type Frame=Record<string,any>;
type Failure={status:ReadFailure;reason:string};
type Live={ipc:Ipc;client:string;owner:string;version:string};
const failed=(v:object):v is Failure=>'status' in v;
export async function desktopVersion():Promise<string|null>{
 try{
  const plist='/Applications/ChatGPT.app/Contents/Info.plist',read=async(k:string)=>(await run('/usr/bin/plutil',['-extract',k,'raw','-o','-',plist],{timeout:5000})).stdout.trim();
  return `${await read('CFBundleShortVersionString')}+${await read('CFBundleVersion')}`;
 }catch{return null;}
}
class Ipc {
 private buffer=Buffer.alloc(0);private waiters:(()=>void)[]=[];private closed=false;private sock:Socket;private timeoutMs:number;
 constructor(sock:Socket,timeoutMs:number){
  this.sock=sock;this.timeoutMs=timeoutMs;
  sock.on('data',d=>{this.buffer=Buffer.concat([this.buffer,d]);this.wake();});
  sock.on('close',()=>{this.closed=true;this.wake();});sock.on('error',()=>{});
 }
 static async connect(path:string,timeoutMs:number){
  const parent=await lstat(dirname(path)),endpoint=await lstat(path),uid=process.getuid!();
  if(!parent.isDirectory()||parent.uid!==uid||parent.mode&0o022||!endpoint.isSocket()||endpoint.uid!==uid)throw new Error('unsafe_ipc');
  const sock=createConnection(path);
  await new Promise<void>((resolve,reject)=>{sock.once('connect',resolve);sock.once('error',reject);});
  return new Ipc(sock,timeoutMs);
 }
 private wake(){const w=this.waiters;this.waiters=[];w.forEach(f=>f());}
 send(frame:Frame){const body=Buffer.from(JSON.stringify(frame));const head=Buffer.alloc(4);head.writeUInt32LE(body.length);this.sock.write(Buffer.concat([head,body]));}
 async next(deadline:number):Promise<Frame>{
  for(;;){
   if(this.buffer.length>=4){
    const size=this.buffer.readUInt32LE(0);if(size<1||size>MAX_FRAME)throw new Error('frame_size');
    if(this.buffer.length>=size+4){const body=this.buffer.subarray(4,size+4);this.buffer=this.buffer.subarray(size+4);return JSON.parse(body.toString('utf8'));}
   }
   if(this.closed)throw new Error('ipc_closed');
   const left=deadline-Date.now();if(left<=0)throw new Error('timeout');
   await new Promise<void>(resolve=>{const t=setTimeout(resolve,left);this.waiters.push(()=>{clearTimeout(t);resolve();});});
  }
 }
 async until<T>(pick:(f:Frame)=>T|undefined,ms=this.timeoutMs):Promise<T>{const deadline=Date.now()+ms;for(;;){const v=pick(await this.next(deadline));if(v!==undefined)return v;}}
 // end() flushes queued frames such as following=false before closing; destroy() could drop them.
 async close(){if(this.sock.destroyed)return;await new Promise<void>(resolve=>{const t=setTimeout(()=>{this.sock.destroy();resolve();},1000);this.sock.end(()=>{clearTimeout(t);resolve();});});this.sock.destroy();}
}
function request(method:string,params:unknown,client:string,version:number,target?:string):Frame{
 return {type:'request',requestId:randomUUID(),sourceClientId:client,version,method,params,timeoutMs:5000,...(target?{targetClientId:target}:{})};
}
async function exchange(ipc:Ipc,frame:Frame){ipc.send(frame);return ipc.until(f=>f.type==='response'&&f.requestId===frame.requestId?f:undefined);}
async function session(nativeId:string,options:CodexOptions):Promise<Failure|Live>{
 const version=await (options.version??desktopVersion)();
 if(!isVersionAllowed('codex',version,options))return {status:'unsupported_version' as const,reason:version??'unknown'};
 let ipc:Ipc;
 try{ipc=await Ipc.connect(options.socketPath??join(homedir(),'.codex','ipc','ipc.sock'),options.timeoutMs??8000);}catch{return {status:'unavailable' as const,reason:'ipc_connect'};}
 try{
  const init=await exchange(ipc,request('initialize',{clientType:CLIENT_TYPE},'initializing-client',0));
  if(init.resultType!=='success'||typeof init.result?.clientId!=='string')throw new Error('initialize');
  const client:string=init.result.clientId;
  const owner=options.owner?await options.owner(nativeId).then(id=>id?{resultType:'success',handledByClientId:id}:null):await exchange(ipc,request('thread-owner-discovery',{hostId:'local',conversationId:nativeId},client,1)).catch(()=>null);
  if(owner?.resultType!=='success'||typeof owner.handledByClientId!=='string'){await ipc.close();const exists=await rolloutExists(nativeId,options);return exists===null?{status:'unavailable',reason:'rollout_unreadable'}:exists?{status:'unavailable',reason:'owner_offline'}:{status:'not_found',reason:'no_owner_no_rollout'};}
  return {ipc,client,owner:owner.handledByClientId as string,version:version??'unknown'};
 }catch{await ipc.close();return {status:'unavailable' as const,reason:'ipc_protocol'};}
}
// File names only; rollout bodies are never opened. null = a directory could not be listed, so absence is unproven.
export async function rolloutExists(nativeId:string,options:CodexOptions={}):Promise<boolean|null>{
 if(!/^[0-9a-f-]{36}$/.test(nativeId))return false;
 const home=options.codexHome??join(homedir(),'.codex');let uncertain=false;
 const walk=async(dir:string,depth:number):Promise<boolean>=>{
  let entries;try{entries=await readdir(dir,{withFileTypes:true});}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')uncertain=true;return false;}
  for(const e of entries){if(e.isFile()&&e.name.startsWith('rollout-')&&e.name.includes(nativeId)&&e.name.endsWith('.jsonl'))return true;if(e.isDirectory()&&depth>0&&await walk(join(dir,e.name),depth-1))return true;}
  return false;
 };
 if(await walk(join(home,'sessions'),3)||await walk(join(home,'archived_sessions'),0))return true;
 return uncertain?null:false;
}
function following(ipc:Ipc,client:string,owner:string,nativeId:string,on:boolean){
 ipc.send({type:'broadcast',sourceClientId:client,targetClientIds:[owner],version:1,method:'thread-stream-following-changed',params:{hostId:'local',conversationId:nativeId,following:on}});
}
// Snapshot only from the discovered owner, addressed to this client, for this conversation.
function snapshot(f:Frame,owner:string,client:string,nativeId:string,minRevision=-1){
 const p=f.params??{},c=p.change??{};
 if(f.type!=='broadcast'||f.method!=='thread-stream-state-changed'||f.version!==11||p.hostId!=='local'||f.sourceClientId!==owner||!(f.targetClientIds??[]).includes(client)||p.conversationId!==nativeId||c.type!=='snapshot')return undefined;
 if(c.conversationState?.id!==nativeId)throw new Error('snapshot_id');
 return (c.revision??-1)>=minRevision?c:undefined;
}
function* turns(state:Frame):Generator<Frame>{
 const h=state.turnHistory;
 if(h?.kind==='canonical')for(const island of h.history?.islands??[])for(const e of island.entries??[]){const t=h.history.entitiesByKey?.[e.value];if(t&&typeof t==='object')yield t;}
 yield* state.turns??[];
}
export function projectCodex(state:Frame):ReadItem[]{
 const items:ReadItem[]=[],seen=new Set<string>();
 for(const turn of turns(state)){
  const at=Number.isFinite(turn.turnStartedAtMs)?new Date(turn.turnStartedAtMs).toISOString():null;
  for(const item of turn.items??[]){
   if(typeof item?.id!=='string'||seen.has(item.id))continue;
   if(item.type==='userMessage'){
    const t=(item.content??[]).filter((c:Frame)=>c?.type==='text').map((c:Frame)=>c.text).join('\n');if(t){seen.add(item.id);items.push({nativeItemId:item.id,role:'user',text:t,at});}
   }else if(item.type==='agentMessage'&&typeof item.text==='string'&&item.text){seen.add(item.id);items.push({nativeItemId:item.id,role:'assistant',text:item.text,at});}
   else if(item.type==='functionCallOutput'&&PEER_NAMESPACES.includes(item.namespace)&&item.name==='external_message'&&typeof item.output==='string'){
    let e;try{e=JSON.parse(item.output);}catch{continue;}
    const envelope=parseEnvelope(item.output),body=envelope?envelope.text:e?.message??e?.text;if(typeof body!=='string')continue;
    const str=(v:unknown)=>typeof v==='string'&&v?v:undefined,peer:NonNullable<ReadItem['peer']>={namespace:item.namespace};
    if(envelope){peer.envelope=envelope;e={sender:envelope.sender.id,messageId:envelope.id,replyTo:envelope.replyTo};}
    const sender=str(e.sender)??str(e.from),mid=str(e.messageId)??str(e.message_id),reply=str(e.replyTo)??str(e.reply_to);
    if(sender)peer.declaredSender=sender;if(mid)peer.messageId=mid;if(reply)peer.replyTo=reply;
    seen.add(item.id);items.push({nativeItemId:item.id,role:'peer',text:body,at,peer});
   }
  }
 }
 return items;
}
export function historyComplete(state:Frame):boolean{
 const h=state.turnHistory,c=h?.history??{};
 return h?.kind==='canonical'&&c.isComplete===true&&(c.islands??[]).length===1&&state.turnsPagination?.hasLoadedOldest===true&&[...turns(state)].every(t=>t.itemsPagination?.hasLoadedOldest!==false);
}
// Follows only the target conversation, keeps the projection in memory, always sends following=false.
async function withState<T extends object>(nativeId:string,options:CodexOptions,complete:boolean,use:(state:Frame,meta:CodexSessionMeta)=>T):Promise<Failure|T>{
 const s=await session(nativeId,options);if(failed(s))return s;
 const {ipc,client,owner,version}=s;let followed=false;
 try{
  following(ipc,client,owner,nativeId,true);followed=true;
  let snap=await ipc.until(f=>snapshot(f,owner,client,nativeId),STEP_MS);
  if(complete&&!historyComplete(snap.conversationState)){
   const load=request('thread-follower-load-complete-history',{conversationId:nativeId},client,1,owner);load.timeoutMs=STEP_MS;
   const ack=await exchange(ipc,load);
   if(ack.resultType!=='success'||ack.handledByClientId!==owner||!Number.isInteger(ack.result?.revision))return {status:'unavailable' as const,reason:'history_load'};
   following(ipc,client,owner,nativeId,true);
   snap=await ipc.until(f=>snapshot(f,owner,client,nativeId,ack.result.revision),STEP_MS);
  }
  const recheck=await exchange(ipc,request('thread-owner-discovery',{hostId:'local',conversationId:nativeId},client,1));
  if(recheck.resultType!=='success'||recheck.handledByClientId!==owner)return {status:'generation_mismatch' as const,reason:'owner_changed'};
  const state=snap.conversationState;
  return use(state,{ownerId:owner,cwd:typeof state.cwd==='string'?state.cwd:null,generation:owner,version});
 }catch{return {status:'unavailable' as const,reason:'ipc_read'};}
 finally{try{if(followed)following(ipc,client,owner,nativeId,false);}finally{await ipc.close();}}
}
export async function observeCodexSession(nativeId:string,options:CodexOptions={}):Promise<CodexSessionMeta|null>{
 const r=await withState(nativeId,options,false,(_state,meta)=>meta);
 return failed(r)?null:r;
}
// Desktop records a running turn (the `/goal` and steer wait) in the conversation state. Any explicit running marker is
// the observed target; a snapshot that cannot be read proves nothing and returns null.
export function codexGoalRunning(state:Frame):boolean{
 if(typeof state.activeTurnId==='string'&&state.activeTurnId)return true;
 return [...turns(state)].some(turn=>typeof turn.status==='string'&&['inProgress','running','active'].includes(turn.status));
}
export async function observeCodexGoal(nativeId:string,options:CodexOptions={}):Promise<boolean|null>{
 const result=await withState(nativeId,options,false,state=>({state}));
 return 'state' in result?codexGoalRunning(result.state):null;
}
export async function observeCodex(registration:Registration,options:CodexOptions={}):Promise<Observation|null>{
 if(registration.provider!=='codex')return null;
 const meta=await observeCodexSession(registration.nativeId,options);if(!meta||!meta.cwd)return null;
 const now=Date.now();
 return {nativeId:registration.nativeId,generation:meta.generation,status:'online',observedAt:now,contextObservedAt:now,source:'codex-desktop-owner',gitSource:'observeGit',cwd:meta.cwd,context:await observeGit(meta.cwd)};
}
export function createCodexReader(options:CodexOptions={}):TranscriptReader{
 return async(target,{complete})=>{
  if(target.provider!=='codex')return {status:'unavailable',reason:'provider'};
  return withState(target.nativeId,options,complete,(state,meta)=>({generation:meta.generation,items:projectCodex(state),complete:historyComplete(state),source:`codex-desktop:${meta.version}`,omitted:OMITTED}));
 };
}
export const readCodexTranscript=createCodexReader();

export function projectCodexStructure(state:Frame):StructureItem[]{
 const result:StructureItem[]=[];
 const recent:{turn:Frame;item:Frame;position:number}[]=[];
 for(const turn of [...turns(state)].reverse()){for(let position=(turn.items??[]).length-1;position>=0&&recent.length<200;position--)recent.push({turn,item:turn.items[position],position});if(recent.length===200)break;}
 for(const {turn,item,position} of recent.reverse()){
  if(typeof item?.id!=='string')continue;
  const peer=projectCodex({turns:[{...turn,items:[item]}]}).find(n=>n.role==='peer')?.peer?.envelope;
  result.push({id:item.id,type:item.type,turnId:typeof turn.turnId==='string'?turn.turnId:turn.id,position,at:Number.isFinite(turn.turnStartedAtMs)?new Date(turn.turnStartedAtMs).toISOString():null,...(peer?{peer:{id:peer.id,sender:{provider:peer.sender.id.split(':')[0],nativeId:peer.sender.nativeId},...(peer.replyTo?{replyTo:peer.replyTo}:{})}}:{})});
 }
 return result.slice(-200);
}
export async function readCodexStructure(target:Registration,options:CodexOptions={}):Promise<StructureItem[]>{
 const result=await withState(target.nativeId,options,false,(state,meta)=>({generation:meta.generation,items:projectCodexStructure(state)}));
 return 'items' in result&&result.generation===target.generation?result.items:[];
}

// Codex writes go through the public CLI (`codex queue --thread <id> --message <text>`). Exit 0 means the reservation
// reached `submitted`; Desktop IPC is only a fallback for a failure the queue returned before that point. A timed-out or
// signalled run is `unknown`, because the queue may already hold the message and invariant 6 forbids a second write.
export const CODEX_QUEUE_TIMEOUT_MS=30_000;
export type CodexQueueRun=(command:string,args:string[],timeoutMs:number)=>Promise<unknown>;
// `body` is the text the ceiling measures when `text` carries a larger wire form (the envelope JSON). Without it the ceiling
// would count the envelope, refusing a short message for its metadata.
export type CodexWriteOptions={limits?:Pick<Limits,'codexMessageMaxChars'>;body?:string;command?:string;timeoutMs?:number;run?:CodexQueueRun;ipc:()=>Promise<Receipt>};
// Only a run that provably never reached the queue may cross over to Desktop IPC; a second write after the queue accepted
// the reservation would double-send (invariant 6). A numeric exit code alone does not prove that: the queue can accept and
// then fail. The two proofs are a spawn error for a command that could not run, and exit code 2 with usage on standard error.
function failedBeforeSubmit(error:unknown):boolean{
 const e=error as (NodeJS.ErrnoException&{killed?:boolean;signal?:string;stderr?:unknown})|null|undefined;
 if(!e||e.killed||e.signal)return false;
 if(typeof e.code==='string')return e.code==='ENOENT'||e.code==='EACCES'||e.code==='ENOTDIR';
 return e.code===2&&typeof e.stderr==='string'&&/\busage\b/i.test(e.stderr);
}
export async function writeCodexMessage(nativeId:string,text:string,messageId:string,options:CodexWriteOptions):Promise<Receipt>{
 if([...(options.body??text)].length>codexMessageMaxChars(options.limits??{}))return {status:'rejected',reason:'too_long'};
 const queueRun=options.run??((command,args,timeoutMs)=>run(command,args,{encoding:'utf8',timeout:timeoutMs,maxBuffer:1024*1024}));
 try{await queueRun(options.command??'codex',['queue','--thread',nativeId,'--message',text],options.timeoutMs??CODEX_QUEUE_TIMEOUT_MS);}
 catch(error){if(!failedBeforeSubmit(error))return {status:'unknown'};try{return await options.ipc();}catch{return {status:'unknown'};}}
 return {status:'submitted',nativeMessageId:messageId};
}

export function projectCodexSentIds(state:Frame,ids:string[],recipient:SendRecipient):string[]{
 const found=new Set<string>();
 for(const turn of turns(state))for(const item of turn.items??[]){
  if(item?.type!=='mcpToolCall'||!['seamless','claudex'].includes(item.server)||item.tool!=='send')continue;
  let args=item.arguments;if(typeof args==='string'){try{args=JSON.parse(args);}catch{continue;}}
  if(typeof args?.id==='string'&&ids.includes(args.id)&&sentTo(args,recipient))found.add(args.id);
 }
 return [...found];
}
export async function readCodexSentIds(target:Registration,ids:string[],recipient:SendRecipient,options:CodexOptions={}):Promise<string[]>{
 const result=await withState(target.nativeId,options,true,(state,meta)=>({generation:meta.generation,ids:projectCodexSentIds(state,ids,recipient)}));
 return 'ids' in result&&result.generation===target.generation?result.ids:[];
}
