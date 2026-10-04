import {sentTo,type SendRecipient} from '../inbound.ts';
import type {StructureItem} from '../status.ts';
import {isClaudeVersionAllowed,type CompatibilityOptions} from '../compat.ts';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { observeGit } from '../git-context.ts';
import type { Observation, Registration } from '../protocol.ts';
import type { ReadItem, Transcript, TranscriptReader } from './read.ts';
import { parseEnvelope } from './read.ts';
const run=promisify(execFile);
const MAX_RECORD_BYTES=65_536,MAX_TRANSCRIPT_BYTES=64*1024*1024;
export type ClaudeSession={version:string;pid:number;sessionId:string;cwd:string;startedAt:number;messagingSocketPath:string|null;generation:string};
export type ClaudeOptions=CompatibilityOptions&{home?:string;processStart?:(pid:number)=>Promise<number|null>};
const OMITTED=['thinking','tool_use','tool_result','images','non_peer_attachments','sidechains'];
// missing = the file does not exist; unreadable = permission, symlink, foreign owner, size or I/O failure.
type Owned={text:string}|{error:'missing'|'unreadable'};
async function readOwned(path:string,limit:number):Promise<Owned>{
 let file;
 try{
  file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const stat=await file.stat();
  if(!stat.isFile()||stat.uid!==process.getuid!()||stat.size>limit)return {error:'unreadable'};
  return {text:(await file.readFile()).toString('utf8')};
 }catch(error){return {error:(error as NodeJS.ErrnoException).code==='ENOENT'?'missing':'unreadable'};}finally{await file?.close();}
}
// Wall-clock start of a live process; null when it is gone. Never reads arguments or environment.
export async function processStart(pid:number):Promise<number|null>{
 try{const {stdout}=await run('ps',['-o','lstart=','-p',String(pid)],{timeout:5000,env:{LC_ALL:'C',PATH:'/bin:/usr/bin'}});const t=Date.parse(stdout.trim());return Number.isFinite(t)?t:null;}catch{return null;}
}
export function claudeTranscriptPath(cwd:string,nativeId:string,options:{home?:string}={}){
 return join(options.home??homedir(),'.claude','projects',cwd.replace(/[^A-Za-z0-9]/g,'-'),`${nativeId}.jsonl`);
}
// null = no record for this session; 'unreadable' = the search itself failed, so absence is unproven.
export async function findClaudeSession(nativeId:string,options:{home?:string}={}):Promise<ClaudeSession|null|'unreadable'>{
 const dir=join(options.home??homedir(),'.claude','sessions');
 let names:string[];try{names=await readdir(dir);}catch(error){return (error as NodeJS.ErrnoException).code==='ENOENT'?null:'unreadable';}
 let uncertain=false;
 for(const name of names){
  if(!/^\d+\.json$/.test(name))continue;
  const raw=await readOwned(join(dir,name),MAX_RECORD_BYTES);
  if(!('text' in raw)){if(raw.error==='unreadable')uncertain=true;continue;}
  let r;try{r=JSON.parse(raw.text);}catch{uncertain=true;continue;}
  if(!r||typeof r!=='object'||typeof r.sessionId!=='string'){uncertain=true;continue;}
  if(r.sessionId!==nativeId)continue;
  if(!Number.isInteger(r.pid)||`${r.pid}.json`!==name||typeof r.cwd!=='string'||!Number.isFinite(r.startedAt)){uncertain=true;continue;}
  return {version:typeof r.version==='string'?r.version:'unknown',pid:r.pid,sessionId:nativeId,cwd:r.cwd,startedAt:r.startedAt,messagingSocketPath:typeof r.messagingSocketPath==='string'?r.messagingSocketPath:null,generation:`${r.pid}@${r.startedAt}`};
 }
 return uncertain?'unreadable':null;
}
// online only when the recorded PID is alive and started within 2s of the record (PID reuse guard).
export async function observeClaudeSession(registration:Registration,options:ClaudeOptions={}):Promise<Observation|null>{
 const session=await findClaudeSession(registration.nativeId,options);if(!session||session==='unreadable')return null;
 const started=await (options.processStart??processStart)(session.pid),now=Date.now();
 const alive=started!==null&&Math.abs(started-session.startedAt)<2000;
 return {nativeId:session.sessionId,generation:session.generation,status:alive?'online':'offline',observedAt:now,contextObservedAt:now,source:'claude-session-record',gitSource:'observeGit',cwd:session.cwd,context:await observeGit(session.cwd)};
}
function text(content:unknown):string{
 if(typeof content==='string')return content;
 return Array.isArray(content)?content.filter(x=>x?.type==='text'&&typeof x.text==='string').map(x=>x.text).join('\n'):'';
}
// Idle peer delivery wraps the raw line in a fixed native header and trailing notice (observed 2026-10-02, Claude Code 2.1.284).
const IDLE_PEER_PREFIX='Another Claude session sent a message:\n';
function peerEnvelope(id:string,body:string){
 const raw=parseEnvelope(body);if(raw)return raw;
 if(!body.startsWith(IDLE_PEER_PREFIX))return null;
 const wrapped=parseEnvelope(body.slice(IDLE_PEER_PREFIX.length).split('\n',1)[0]!);
 return wrapped?.id===id?wrapped:null; // the native record uuid is the request id
}
function peerItem(id:string,body:string,at:string|null,from:unknown,mid:unknown):ReadItem{
 const envelope=peerEnvelope(id,body),peer:NonNullable<ReadItem['peer']>={namespace:'claude-peer'};
 if(typeof from==='string')peer.declaredSender=from;if(typeof mid==='string')peer.messageId=mid;
 if(envelope){peer.envelope=envelope;peer.messageId=envelope.id;if(envelope.replyTo)peer.replyTo=envelope.replyTo;}
 return {nativeItemId:id,role:'peer',text:envelope?envelope.text:body,at,peer};
}
export function projectClaude(lines:string[],nativeId:string):ReadItem[]{
 const items:ReadItem[]=[];
 for(const line of lines){
  let r;try{r=JSON.parse(line);}catch{continue;}
  if(r?.sessionId!==nativeId||r.isSidechain||typeof r.uuid!=='string')continue;
  const at=typeof r.timestamp==='string'?r.timestamp:null;
  if(r.type==='user'&&(r.origin?.kind==='peer'||!r.isMeta)){
   const content=r.message?.content,peer=r.origin?.kind==='peer';
   if(Array.isArray(content)&&content.some(x=>x?.type==='tool_result'))continue;
   const t=text(content);if(!t)continue;
   items.push(peer?peerItem(r.uuid,t,at,r.origin.from,r.origin.msg_id):{nativeItemId:r.uuid,role:'user',text:t,at});
  }else if(r.type==='assistant'){
   const t=text(r.message?.content);if(t)items.push({nativeItemId:r.uuid,role:'assistant',text:t,at});
  }else if(r.type==='attachment'&&r.attachment?.type==='queued_command'&&r.attachment.origin?.kind==='peer'&&typeof r.attachment.prompt==='string'){
   const a=r.attachment;items.push(peerItem(r.uuid,a.prompt,a.timestamp??at,a.origin.from,a.origin.msg_id??a.source_uuid));
  }
 }
 return items;
}
export function createClaudeReader(options:ClaudeOptions={}):TranscriptReader{
 return async target=>{
  if(target.provider!=='claude')return {status:'unavailable',reason:'provider'};
  const session=await findClaudeSession(target.nativeId,options);
  if(session==='unreadable')return {status:'unavailable',reason:'session_record_unreadable'};
  if(!session)return {status:'not_found',reason:'session_record'};
  if(!isClaudeVersionAllowed(session.version,options))return {status:'unsupported_version',reason:session.version};
  const raw=await readOwned(claudeTranscriptPath(session.cwd,target.nativeId,options),MAX_TRANSCRIPT_BYTES);
  if('error' in raw)return raw.error==='missing'?{status:'not_found',reason:'transcript'}:{status:'unavailable',reason:'transcript_unreadable'};
  return {generation:session.generation,items:projectClaude(raw.text.split('\n'),target.nativeId),complete:true,source:'claude-transcript',omitted:OMITTED} satisfies Transcript;
 };
}
export const readClaudeTranscript=createClaudeReader();

export function projectClaudeStructure(lines:string[],nativeId:string):StructureItem[]{
 const result:StructureItem[]=[];
 for(const line of lines.filter(line=>line.trim()).slice(-200)){
  let r;try{r=JSON.parse(line);}catch{continue;}
  if(r?.sessionId!==nativeId||r.isSidechain||typeof r.uuid!=='string')continue;
  const peer=projectClaude([line],nativeId).find(n=>n.role==='peer'&&n.peer?.declaredSender==='claudex')?.peer?.envelope;
  result.push({id:r.uuid,type:r.type,parentUuid:typeof r.parentUuid==='string'?r.parentUuid:null,at:typeof r.timestamp==='string'?r.timestamp:null,...(peer?{peer:{id:peer.id,sender:{provider:peer.sender.id.split(':')[0],nativeId:peer.sender.nativeId},...(peer.replyTo?{replyTo:peer.replyTo}:{})}}:{})});
 }
 return result.slice(-200);
}
export async function readClaudeStructure(target:Registration,options:ClaudeOptions={}):Promise<StructureItem[]>{
 const session=await findClaudeSession(target.nativeId,options);
 if(!session||session==='unreadable'||session.generation!==target.generation||!isClaudeVersionAllowed(session.version,options))return [];
 const raw=await readOwned(claudeTranscriptPath(session.cwd,target.nativeId,options),MAX_TRANSCRIPT_BYTES);
 return 'text' in raw?projectClaudeStructure(raw.text.split('\n'),target.nativeId):[];
}

// Only the requested identifiers leave this projection, never tool inputs.
export function projectClaudeSentIds(lines:string[],nativeId:string,ids:string[],recipient:SendRecipient):string[]{
 const found=new Set<string>();
 for(const line of lines){
  let r;try{r=JSON.parse(line);}catch{continue;}
  if(r?.sessionId!==nativeId||r.isSidechain||r.type!=='assistant'||!Array.isArray(r.message?.content))continue;
  for(const item of r.message.content){
   if(item?.type!=='tool_use'||typeof item.name!=='string')continue;
   const sendTool=/^(?:mcp__)?claudex(?:__|\.)send$/.test(item.name);
   const input=sendTool?item.input:item.name==='Bash'?bashSendInput(item.input?.command):null;
   if(input&&typeof input.id==='string'&&ids.includes(input.id)&&sentTo(input,recipient))found.add(input.id);
  }
 }
 return [...found];
}
export async function readClaudeSentIds(target:Registration,ids:string[],recipient:SendRecipient,options:ClaudeOptions={}):Promise<string[]>{
 const session=await findClaudeSession(target.nativeId,options);
 if(!session||session==='unreadable'||session.generation!==target.generation||!isClaudeVersionAllowed(session.version,options))return [];
 const raw=await readOwned(claudeTranscriptPath(session.cwd,target.nativeId,options),MAX_TRANSCRIPT_BYTES);
 return 'text' in raw?projectClaudeSentIds(raw.text.split('\n'),target.nativeId,ids,recipient):[];
}

// Parse literal shell words only. Expansions, pipelines and compound commands are not evidence.
function bashSendInput(command:unknown):Record<string,unknown>|null{
 if(typeof command!=='string')return null;
 const words:string[]=[];let word='',quote='',active=false;
 for(let i=0;i<command.length;i++){
  const c=command[i];
  if(quote==="'"){if(c==="'")quote='';else word+=c;continue;}
  if(quote==='"'){
   if(c==='"'){quote='';continue;}
   if(c==='$'||c==='`')return null;
   if(c==='\\'&&['"','\\','$','`'].includes(command[i+1])){word+=command[++i];continue;}
   word+=c;continue;
  }
  if(c==='\n'||c==='\r')return null;
  if(/\s/.test(c)){if(active){words.push(word);word='';active=false;}continue;}
  if(c==="'"||c==='"'){quote=c;active=true;continue;}
  if(/[;&|<>$`()#*?{}\[\]~]/.test(c))return null;
  if(c==='\\'){if(i+1===command.length)return null;word+=command[++i];}else word+=c;
  active=true;
 }
 if(quote)return null;if(active)words.push(word);
 if(words.length!==4||!/(^|\/)node$/.test(words[0])||!/(^|\/)cli\.ts$/.test(words[1])||words[2]!=='send')return null;
 try{const input=JSON.parse(words[3]);return input&&typeof input==='object'&&!Array.isArray(input)?input:null;}catch{return null;}
}
