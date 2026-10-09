import {requestHash,claimRequest,reservationFile,type RequestRecord} from './request-store.ts';
import type {StructureItem} from './status.ts';
import { mkdir, open, lstat, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Discovery } from './discovery.ts';
import { Registry, permitted } from './registry.ts';
import { ContractError, object } from './protocol.ts';
import type { Registration } from './protocol.ts';
export type Envelope={id:string;sender:{id:string;nativeId:string;generation:string};recipient:{id:string;nativeId:string;generation:string};text:string;replyTo?:string};
export type Receipt={status:'submitted'|'unknown'|'rejected';nativeMessageId?:string;payloadSha256?:string;reason?:string;version?:string};
export type NativeAdapter={inboxState?:(target:Registration,id:string,sender:{id:string;nativeId:string})=>Promise<string|null>;received?:(target:Registration)=>Promise<import("./inbound.ts").Received[]>;sentIds?:(target:Registration,ids:string[],recipient:Pick<Registration,'provider'|'nativeId'>)=>Promise<string[]>;structure?:(target:Registration)=>Promise<StructureItem[]>;inbound?:(recipient:Registration)=>Promise<Envelope[]>;read:(target:Registration,options:{cursor?:string;limit?:number})=>Promise<unknown>;send:(target:Registration,envelope:Envelope,authorize?:()=>Promise<boolean>)=>Promise<Receipt>};
export class Delivery {
 private tracking?:{keyPath:string;now?:()=>number};
 private discovery:Discovery;
 private fixedTarget?:Registration;private validate?:()=>Promise<string|null>;private holdSubmittedMs?:number;
 private inbound=new Map<string,Envelope>();
 private attempts=new Map<string,{hash:string;result:Promise<unknown>}>();
 private reservationDir:string;private refreshHook:()=>Promise<void>;
 private registry:Registry;private caller:string;private adapter:NativeAdapter;
 constructor(registry:Registry,caller:string,adapter:NativeAdapter,options:{tracking?:{keyPath:string;now?:()=>number};refresh?:()=>Promise<void>;reservationDir?:string;fixedTarget?:Registration;validate?:()=>Promise<string|null>;holdSubmittedMs?:number}={}){this.tracking=options.tracking;this.holdSubmittedMs=options.holdSubmittedMs;this.fixedTarget=options.fixedTarget;this.validate=options.validate;this.refreshHook=options.refresh??(async()=>{});this.reservationDir=options.reservationDir??join(homedir(),'.seamless','reservations');this.registry=registry;this.caller=caller;this.adapter=adapter;this.discovery=new Discovery(registry,caller,options);}
 acceptInbound(envelope:Envelope):boolean {
  const caller=this.registry.get(this.caller),sender=this.registry.get(envelope.sender.id);
  if(!caller||!sender||!permitted(sender,caller,'send')||envelope.recipient.id!==caller.id||envelope.recipient.nativeId!==caller.nativeId||envelope.recipient.generation!==caller.generation||envelope.sender.nativeId!==sender.nativeId||envelope.sender.generation!==sender.generation)return false;
  const old=this.inbound.get(envelope.id);if(old)return JSON.stringify(old)===JSON.stringify({...envelope,text:''});
  if(this.inbound.size>=10000)return false;
  this.inbound.set(envelope.id,{...structuredClone(envelope),text:''});return true;
 }
 async read(input:unknown):Promise<unknown>{
  const p=object(input,['target','scope','cursor','limit']);
  if(p.cursor!==undefined&&typeof p.cursor!=='string'||p.limit!==undefined&&(!Number.isInteger(p.limit)||Number(p.limit)<1||Number(p.limit)>100))throw new ContractError();
  const selected=await this.discovery.select({operation:'read',target:p.target,scope:p.scope});
  if(selected.status!=='selected')return selected;
  const checked=await this.discovery.revalidate(selected.binding!);if(checked.status!=='validated')return checked;
  const target=this.registry.get(checked.target!)!;
  return this.adapter.read(target,{...(p.cursor===undefined?{}:{cursor:p.cursor as string}),...(p.limit===undefined?{}:{limit:p.limit as number})});
 }
 async send(input:unknown):Promise<unknown>{
  const p=object(input,['target','scope','id','text','replyTo']);
  if(typeof p.id!=='string'||!p.id||p.id.length>256||typeof p.text!=='string'||!p.text||Buffer.byteLength(p.text)>32768||p.replyTo!==undefined&&(typeof p.replyTo!=='string'||!p.replyTo))throw new ContractError();
  if(p.replyTo!==undefined){if(this.adapter.inbound){const recipient=this.registry.get(this.caller);if(recipient){for(const envelope of await this.adapter.inbound(recipient)){if(!this.acceptInbound(envelope)&&envelope.id===p.replyTo)return {status:'invalid_reply'};}}}const original=this.inbound.get(p.replyTo as string);if(!original&&this.tracking)return {status:'reply_target_not_yet_visible'};if(!original||original.replyTo||p.target!==original.sender.id)return {status:'invalid_reply'};const sender=this.registry.get(original.sender.id),caller=this.registry.get(this.caller);if(!sender||!caller||sender.nativeId!==original.sender.nativeId||sender.generation!==original.sender.generation||caller.nativeId!==original.recipient.nativeId||caller.generation!==original.recipient.generation)return {status:'invalid_reply'};}
  const hash=createHash('sha256').update(JSON.stringify([p.target,p.scope??'current_work',p.text,p.replyTo??null])).digest('hex');
  const previous=this.attempts.get(p.id);if(previous)return previous.hash===hash?previous.result:{status:'id_conflict'};
  // Reserve before the first await so concurrent calls cannot duplicate native writes.
  if(this.attempts.size>=10000)return {status:'capacity_reached'};
  const result=this.tracking?this.trackedSend(p):this.performSend(p,hash);this.attempts.set(p.id,{hash,result});return result;
 }
 private async trackedSend(p:Record<string,unknown>):Promise<unknown>{
  const sender=this.registry.get(this.caller)!,target=this.fixedTarget!;
  let claim:Awaited<ReturnType<typeof claimRequest>>|undefined;
  try{
   const hash=await requestHash(this.tracking!.keyPath,[sender.provider,sender.nativeId,target.provider,target.nativeId,p.replyTo??null,p.text]);
   claim=await claimRequest(this.reservationDir,hash,p.id as string,(this.tracking!.now??Date.now)(),{holdSubmittedMs:this.holdSubmittedMs});
   if(claim.duplicate)return claim.previous==='submitted'?{status:'duplicate',requestId:claim.duplicate,previous:'submitted'}:{status:'duplicate_of_unknown',requestId:claim.duplicate};
   const result=await this.performSend(p,hash) as {status:string};
   if(result.status!=='unknown'&&!(this.holdSubmittedMs!==undefined&&result.status==='submitted'))await claim.release();
   return result;
  }catch{return {status:'reservation_unavailable'};}
 }
 private async performSend(p:Record<string,unknown>,hash:string):Promise<unknown>{
  let checked:{status:string;target?:string};
  if(this.fixedTarget){const reason=await this.validate?.();if(reason)return {status:reason};checked={status:'validated',target:this.fixedTarget.id};}
  else{const selected=await this.discovery.select({operation:'send',target:p.target,scope:p.scope});if(selected.status!=='selected')return selected;
   checked=await this.discovery.revalidate(selected.binding!);if(checked.status!=='validated')return checked;}
  const sender=this.registry.get(this.caller)!,target=this.registry.get(checked.target!)!;
  const identity=(r:Registration)=>({id:r.id,nativeId:r.nativeId,generation:r.generation});
  const envelope:Envelope={id:p.id as string,text:p.text as string,sender:identity(sender),recipient:identity(target),...(p.replyTo===undefined?{}:{replyTo:p.replyTo as string})};
  const party=(r:Registration)=>({id:r.id,provider:r.provider,nativeId:r.nativeId,generation:r.generation,cwd:r.workspace});
  const metadata=this.tracking?{id:envelope.id,sender:party(sender),recipient:party(target),...(envelope.replyTo?{replyTo:envelope.replyTo}:{}),at:(this.tracking.now??Date.now)()}:{};
  let path:string;
  try{
   await mkdir(this.reservationDir,{recursive:true,mode:0o700});const dir=await lstat(this.reservationDir);
   if(!dir.isDirectory()||dir.isSymbolicLink()||(dir.mode&0o777)!==0o700||dir.uid!==process.getuid?.())return {status:'reservation_unavailable'};
   path=join(this.reservationDir,reservationFile(sender.provider,sender.host,sender.nativeId,p.id as string));
   let file;
   try{file=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);await file.writeFile(JSON.stringify({hash,status:'pending',at:Date.now(),...metadata}));await file.sync();}
   catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')return {status:'reservation_unavailable'};let existing;try{existing=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);const stat=await existing.stat();if(!stat.isFile()||(stat.mode&0o777)!==0o600||stat.uid!==process.getuid?.()||stat.size>16384)return {status:'reservation_unavailable'};const record=JSON.parse(await existing.readFile('utf8'));if(record.hash!==hash)return {status:'id_conflict'};return {status:record.status==='submitted'?'submitted':record.status==='rejected'?'rejected':'unknown'};}catch{return {status:'unknown'};}finally{await existing?.close();}}
   finally{await file?.close();}
  }catch{return {status:'reservation_unavailable'};}
  let denied:string|null=null,recheckRejected=false;
  const authorize=async()=>{denied=await this.validate?.()??null;if(denied){recheckRejected=true;return false;}try{await this.refreshHook();}catch{recheckRejected=true;return false;}const currentSender=this.registry.get(sender.id),currentTarget=this.registry.get(target.id);const allowed=!!currentSender&&!!currentTarget&&JSON.stringify(currentSender)===JSON.stringify(sender)&&JSON.stringify(currentTarget)===JSON.stringify(target)&&permitted(currentSender,currentTarget,'send');if(!allowed)recheckRejected=true;return allowed;};
  let receipt:Receipt;try{receipt=await authorize()?await this.adapter.send(target,envelope,authorize):{status:'rejected'};}catch{receipt={status:'unknown'};}
  // The payload hash stays in the private record only; no returned receipt carries it.
  const {payloadSha256,...visible}=receipt;receipt=visible;
  if(receipt.status==='rejected'&&recheckRejected){
   try{await unlink(path);}catch{return {status:'unknown'};}
   this.attempts.delete(p.id as string);
   return denied?{status:denied}:receipt;
  }
  // A lost process leaves pending; another process never retries that reservation.
  const temporary=path+'.'+randomUUID();let state;
  try{state=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);await state.writeFile(JSON.stringify({hash,status:receipt.status,at:Date.now(),...metadata,...(payloadSha256?{payloadSha256}:{})}));await state.sync();await state.close();state=undefined;await rename(temporary,path);}catch{receipt={status:'unknown'};}finally{await state?.close();}
  if(receipt.status==='rejected'&&!denied)denied=await this.validate?.()??null;
  return denied&&receipt.status==='rejected'?{status:denied}:receipt;
 }
}
