import {mkdir,lstat,readdir,unlink,link,open,rename} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {DAY,privateJson,publish,reservationOf} from './request-store.ts';

// Nonces of signed envelopes from a registered outside sender (specs/202610-more-peers T2-3).
// One file per (registration, nonce), created in one step with its content (exclusive), so of two envelopes presented at once
// exactly one creates it and the other finds it. The files are on disk, so a restart forgets nothing.
// A record is kept 24 hours: longer than the five-minute window in which a signature is accepted at all.
//
// Nothing here reads the whole store on the path of a request. A request that reached its write also gets a second name for the same
// record, derived from what a recipient can see of it (registration, key version, request id, destination), so "was this one checked"
// is one file; and the store is swept for expired records at most once an hour.
export const NONCE_RETENTION_MS=DAY;
export const SWEEP_EVERY_MS=3600_000;
// signedBy:'mac' marks a record whose signature this Mac made itself (`bot-send|bot-sessions`, src/bot-sign.ts), not the Bot: what it
// vouches for is only that the signature fits the key, so a recipient is not told "verified" on its strength (wasSigned).
export type NonceRecord={peer:string;keyVersion:number;nonce:string;op:'send'|'sessions';id:string;recipient:string;signatureSha256:string;at:number;signedBy?:'mac'};
export type NonceClaim={status:'claimed'}|{status:'seen';record:NonceRecord|null};
const FILE=/^[0-9a-f]{64}\.json$/,BY_REQUEST=/^[0-9a-f]{64}\.req$/,MARKER='last-sweep.mark';
const sha=(parts:unknown[])=>createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const fileOf=(peer:string,nonce:string)=>sha([peer,nonce])+'.json';
const byRequest=(peer:string,keyVersion:number,id:string,recipient:string)=>sha(['request',peer,keyVersion,id,recipient])+'.req';
function validRecord(r:any):r is NonceRecord{
 return !!r&&typeof r==='object'&&typeof r.peer==='string'&&Number.isSafeInteger(r.keyVersion)&&typeof r.nonce==='string'&&['send','sessions'].includes(r.op)&&typeof r.id==='string'&&typeof r.recipient==='string'&&typeof r.signatureSha256==='string'&&Number.isFinite(r.at)&&(r.signedBy===undefined||r.signedBy==='mac');
}
async function ensureDir(dir:string){
 await mkdir(dir,{recursive:true,mode:0o700});
 const s=await lstat(dir);
 if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid?.()||(s.mode&0o777)!==0o700)throw Error('unsafe_store');
}
async function stamp(path:string,at:number){
 const tmp=path+'.'+randomUUID();let f;
 try{f=await open(tmp,'wx',0o600);await f.writeFile(JSON.stringify({at}));await f.close();f=undefined;await rename(tmp,path);}finally{await f?.close();await unlink(tmp).catch(()=>{});}
}
// Best effort: a record that cannot be removed stays and only makes the store stricter. The hour is counted on the clock the caller
// gives (the one that dates the records), and the time of a sweep is written before it starts, so two requests together do not both sweep.
async function sweep(dir:string,now:number){
 const marker=join(dir,MARKER),last=await privateJson(marker);
 if(last&&Number.isFinite(last.at)&&last.at<=now&&now-last.at<SWEEP_EVERY_MS)return;
 await stamp(marker,now).catch(()=>{});
 for(const name of await readdir(dir).catch(()=>[])){
  if(!FILE.test(name)&&!BY_REQUEST.test(name))continue;
  const record=await privateJson(join(dir,name));
  if(validRecord(record)&&now-record.at>NONCE_RETENTION_MS)await unlink(join(dir,name)).catch(()=>{});
 }
}
export async function claimNonce(dir:string,record:NonceRecord,now:number):Promise<NonceClaim>{
 await ensureDir(dir);
 await sweep(dir,now);
 const path=join(dir,fileOf(record.peer,record.nonce));
 if(await publish(path,JSON.stringify(record))){
  // The same inode under the second name: same content, same age, same permissions. If a request id is signed again, the first
  // record already vouches for it and the second name is left alone; if it cannot be made, the request just stays unvouched.
  // A signature this Mac made takes the second name over in one step (rename), so a request it delivered under an id the Bot had
  // signed before (and that was not delivered then) is never shown as the Bot's. It can only lower what a request is shown as.
  if(record.op==='send'){
   const target=join(dir,byRequest(record.peer,record.keyVersion,record.id,record.recipient));
   // If the name cannot be taken over, the request is not delivered: an older record of the Bot would vouch for what this Mac signed.
   if(record.signedBy==='mac'){const tmp=target+'.'+randomUUID();try{await link(path,tmp);await rename(tmp,target);}catch{await unlink(tmp).catch(()=>{});throw Error('vouch_unavailable');}}
   else await link(path,target).catch(()=>{});
  }
  return {status:'claimed'};
 }
 const old=await privateJson(path);
 return {status:'seen',record:validRecord(old)?old:null};
}
// What "verified" means for a received envelope from a registered outside sender: this Mac checked its signature AND got as far as
// the write. Two records say so, and both must be there: the nonce record (the signature passed and the nonce was spent) and the
// reservation the delivery made before writing (nothing but the outside-sender path creates one whose sender is "grok-bot:<name>").
// A request refused after the signature check (offline, out of scope, a generation that moved) leaves a nonce but no reservation.
// A record this Mac signed itself (signedBy 'mac') proves nothing about the Bot, so it never makes a message verified. A reservation the native side refused ('rejected') proves nothing was delivered. Both name the same registration, key version,
// request id and destination as the envelope the recipient holds. Each is one file, found by name.
export async function wasSigned(nonceDir:string,reservationDir:string,envelope:{id:string;sender:{id:string;nativeId:string;generation:string};recipient:{id:string;nativeId:string;generation:string}}):Promise<boolean>{
 if(envelope.sender.id!=='grok-bot:'+envelope.sender.nativeId)return false;
 const keyVersion=Number(envelope.sender.generation),recipient=envelope.recipient.id+':'+envelope.recipient.generation;
 if(!Number.isSafeInteger(keyVersion))return false;
 const r=await privateJson(join(nonceDir,byRequest(envelope.sender.nativeId,keyVersion,envelope.id,recipient)));
 if(!validRecord(r)||r.signedBy==='mac'||!(r.op==='send'&&r.peer===envelope.sender.nativeId&&String(r.keyVersion)===envelope.sender.generation&&r.id===envelope.id&&r.recipient===recipient))return false;
 const q=await reservationOf(reservationDir,'grok-bot','external',envelope.sender.nativeId,envelope.id);
 return !!q&&q.sender.id===envelope.sender.id&&q.sender.nativeId===envelope.sender.nativeId&&q.recipient.id===envelope.recipient.id&&q.recipient.generation===envelope.recipient.generation&&q.status!=='rejected';
}
