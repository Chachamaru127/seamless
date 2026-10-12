import {constants} from 'node:fs';
import {mkdir,open,link,unlink,readdir,lstat} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto';
export type RequestParty={id:string;provider:'claude'|'codex'|'grok'|'grok-bot';nativeId:string;generation:string;cwd:string};
// A request party is a local conversation, or a registered outside executor (grok-bot) that has no process on this Mac.
export type LocalParty=RequestParty&{provider:'claude'|'codex'|'grok'};
export const isLocalParty=(p:RequestParty):p is LocalParty=>p.provider!=='grok-bot';
export type RequestRecord={id:string;sender:RequestParty;recipient:RequestParty;replyTo?:string;at:number;hash:string;payloadSha256?:string;replyTokenSha256?:string;status:string};
export const DAY=86400000;
export async function privateJson(path:string):Promise<any>{
 let file;try{file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const s=await file.stat();if(!s.isFile()||s.uid!==process.getuid?.()||(s.mode&0o777)!==0o600||s.size>16384)return null;return JSON.parse(await file.readFile('utf8'));}catch{return null;}finally{await file?.close();}
}
export async function publish(path:string,contents:string|Buffer){
 const tmp=path+'.'+randomUUID();let f;
 try{f=await open(tmp,'wx',0o600);await f.writeFile(contents);await f.sync();await f.close();f=undefined;await link(tmp,path);return true;}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')return false;throw e;}finally{await f?.close();await unlink(tmp).catch(()=>{});}
}
export async function requestHash(keyPath:string,parts:unknown[]):Promise<string>{
 await mkdir(dirname(keyPath),{recursive:true,mode:0o700});
 await publish(keyPath,randomBytes(32));
 const f=await open(keyPath,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const s=await f.stat();if(!s.isFile()||s.uid!==process.getuid?.()||(s.mode&0o777)!==0o600||s.size!==32)throw Error('unsafe_key');return createHmac('sha256',await f.readFile()).update(JSON.stringify(parts)).digest('hex');}finally{await f.close();}
}
// A persistent claim also covers a process lost between reservation and native write. It is released once the request is settled
// ('rejected' always, 'submitted' too) so the same content may be sent again; with holdSubmittedMs a submitted request keeps the claim
// for that long (at most the day an unknown one keeps it), so the same content under another id is a duplicate of it (a registered
// outside sender whose answer may have been lost: specs/202610-more-peers AC7).
export async function claimRequest(dir:string,hash:string,id:string,now:number,options:{holdSubmittedMs?:number}={}):Promise<{duplicate?:string;previous?:string;release:()=>Promise<void>}>{
 await mkdir(dir,{recursive:true,mode:0o700});const s=await lstat(dir);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid?.()||(s.mode&0o777)!==0o700)throw Error('unsafe_store');
 const path=join(dir,hash+'.claim');
 if(!await publish(path,JSON.stringify({id,at:now}))){
  const old=await privateJson(path);if(!old||typeof old.id!=='string'||!Number.isFinite(old.at))throw Error('claim_unreadable');
  if(old.id===id)return {release:async()=>{}};
  const prior=(await requests(dir)).find(r=>r.id===old.id&&r.hash===hash);
  const settled=!!prior&&(prior.status==='rejected'||prior.status==='submitted'&&!(options.holdSubmittedMs!==undefined&&now-old.at<=options.holdSubmittedMs));
  if(now-old.at<=DAY&&!settled)return {duplicate:old.id,...(prior?{previous:prior.status}:{}),release:async()=>{}};
  // Expired claims are moved out of the namespace under a separate exclusive lock.
  const lock=path+'.expire';let handle;
  try{handle=await open(lock,'wx',0o600);const current=await privateJson(path);if(current&&current.id===old.id&&current.at===old.at)await unlink(path);}
  catch{throw Error('claim_busy');}finally{await handle?.close();if(handle)await unlink(lock).catch(()=>{});}
  return claimRequest(dir,hash,id,now,options);
 }
 return {release:async()=>{const current=await privateJson(path);if(current?.id===id)await unlink(path).catch(()=>{});}};
}
function isRecord(r:any):r is RequestRecord{return r&&typeof r.id==='string'&&typeof r.hash==='string'&&typeof r.status==='string'&&Number.isFinite(r.at)&&[r.sender,r.recipient].every(p=>p&&['claude','codex','grok','grok-bot'].includes(p.provider)&&['id','nativeId','generation','cwd'].every(k=>typeof p[k]==='string'));}
// The reservation of one request is one file whose name is fixed by who asked and the id (see Delivery), so it can be read without
// listing the directory.
export const reservationFile=(provider:string,host:string,nativeId:string,id:string)=>createHash('sha256').update(JSON.stringify([provider,host,nativeId,id])).digest('hex')+'.json';
export async function reservationOf(dir:string,provider:string,host:string,nativeId:string,id:string):Promise<RequestRecord|null>{
 const r=await privateJson(join(dir,reservationFile(provider,host,nativeId,id)));
 return isRecord(r)&&r.id===id?r:null;
}
export async function requests(dir:string):Promise<RequestRecord[]>{
 const out:RequestRecord[]=[];for(const name of await readdir(dir).catch(()=>[])){if(!/^[a-f0-9]{64}\.json$/.test(name))continue;const r=await privateJson(join(dir,name));if(isRecord(r))out.push(r);}return out;
}
