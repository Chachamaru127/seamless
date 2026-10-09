import {readPeers,peerStatus,peerOperations,scopeAllows,type Peer,type Peers} from './peers.ts';
import {readLimits,unrestricted,type Limits,type AutoScope} from './limits.ts';
import {parseSignedEnvelope,parseRecipient,verifySignature,withinWindow,signatureDigest,LIST_RECIPIENT,type SignedEnvelope} from './signed-envelope.ts';
import {claimNonce} from './nonce-store.ts';
import {Delivery,type NativeAdapter,type Envelope} from './delivery.ts';
import {Registry} from './registry.ts';
import {requests,requestHash,reservationOf,DAY} from './request-store.ts';
import {inScope,type SessionIdentity,type ScanOptions,type scanSessions} from './sessions-scan.ts';
import {ContractError,type Registration} from './protocol.ts';
import type {NativeIdentity} from './native-runtime.ts';

// `seamless send|sessions|read --as <registration>`: a registered outside sender (Grok Bot) asks this Mac to act, with an
// envelope the Bot signed (specs/202610-more-peers T2-3 to T2-5). The signed fields are the only source of the sender and the
// destination; no separate target argument exists, so a destination cannot be swapped without breaking the signature.
// Order: shape -> roster -> revoked -> key version -> key -> signature -> time -> roster authorization -> nonce -> destination
// -> reservation. Anything that does not pass stops there and nothing is delivered.
export type ExternalDeps={
 name:string;home:string;now:()=>number;env:NodeJS.ProcessEnv;
 // One line for the owner about why a request was refused when the Bot must not be told (names of variables only, never a value).
 diagnose:(line:string)=>void;
 peersPath:string;limitsPath:string;reservationDir:string;keyPath:string;nonceDir:string;
 scan:(cwd:string,scope:AutoScope)=>ReturnType<typeof scanSessions>;
 inspect:(session:SessionIdentity)=>Promise<NativeIdentity|null>;
 adapter:NativeAdapter;
 git:NonNullable<ScanOptions['git']>;
 excluded:(n:{provider:'claude'|'codex'|'grok';nativeId:string;generation:string;cwd:string},limits:Limits)=>Promise<boolean>;
 rejectedVersion:(n:Pick<SessionIdentity,'provider'|'version'>,limits:Limits)=>{status:string}|null;
 compatibility:(n:Pick<SessionIdentity,'provider'|'nativeId'|'version'>,limits:Limits)=>Promise<{status:string}|null>;
};
type Reason={reason:string};
// How long a delivered request still stops the same content (same destination, same replyTo) under another id: the day an unknown
// result is remembered for. A Bot that lost the answer and signs the request anew gets "duplicate" instead of a second delivery;
// shorten it here if a day of "the same words, once" is too long for the way the Bot talks.
export const SAME_CONTENT_HOLD_MS=DAY;
const botId=(name:string)=>`grok-bot:${name}`;
// The registration's scope AND the owner's limits. Limits scope is relative to a caller's folder, and a registration has no
// caller folder, so each listed folder of the registration stands in for it; a registration for every folder cannot satisfy a
// narrower limits scope (nothing to measure it against), and an absent limits file does not widen a registration.
async function inRange(d:ExternalDeps,peer:Peer,limits:Limits,cwd:string):Promise<boolean>{
 if(!await scopeAllows(peer,cwd))return false;
 if(limits.scope===null||limits.scope==='any')return true;
 if(!Array.isArray(peer.scope))return false;
 for(const root of peer.scope)if(await inScope(cwd,root,limits.scope,d.git))return true;
 return false;
}
// Two key variables holding one value cannot tell which holder signed: the receive key of this registration must differ from every
// other key variable of the roster, this registration's send key included. Values are only compared, never kept or shown.
function keyTwin(roster:Peers,env:NodeJS.ProcessEnv,self:Peer,key:string):string|null{
 for(const p of roster.peers)for(const slot of ['sendKeyEnv','receiveKeyEnv'] as const){
  if(p.name===self.name&&slot==='receiveKeyEnv')continue;
  if(env[p[slot]]===key)return `${p.name} ${slot}`;
 }
 return null;
}
// Everything about the sender that must hold both now and again just before the write: the roster entry (not revoked, same key
// version, scope set, may send) and the owner's limits. Returns the registration or the reason it is refused.
async function authorize(d:ExternalDeps,name:string,keyVersion:number):Promise<{peer:Peer;limits:Limits}|Reason>{
 const roster=await readPeers(d.peersPath);
 if(roster.status==='unusable')return {reason:'peers_unusable'};
 const peer=roster.status==='ok'?roster.value.peers.find(p=>p.name===name):undefined;
 if(!peer)return {reason:'sender_unregistered'};
 if(peer.revoked)return {reason:'key_revoked'};
 if(peer.keyVersion!==keyVersion)return {reason:'key_version_mismatch'};
 if(peerStatus(peer)==='scope_unset')return {reason:'scope_unset'};
 if(!peerOperations(peer).send)return {reason:'operation_not_permitted'};
 const loaded=await readLimits(d.limitsPath);
 if(loaded.status==='unusable')return {reason:'limits_unusable'};
 const limits=loaded.status==='ok'?loaded.value:unrestricted;
 if(limits.operations?.send===false)return {reason:'operation_not_permitted'};
 if(limits.scope!==null&&limits.scope!=='any'&&!Array.isArray(peer.scope))return {reason:'scope_conflict'};
 return {peer,limits};
}
const refused=(r:unknown):r is Reason=>!!r&&typeof r==='object'&&'reason' in r;
export async function externalCall(d:ExternalDeps,method:string,input:unknown):Promise<any>{
 if(method==='read')return {status:'operation_not_permitted',reason:'external_read'};
 if(method!=='sessions'&&method!=='send')throw new ContractError('unknown_method');
 const parsed=parseSignedEnvelope(input);
 if(!parsed.ok)return {status:'envelope_invalid',reason:parsed.reason};
 const env=parsed.envelope;
 if(env.sender!==d.name)return {status:'sender_mismatch'};
 const to=method==='send'?parseRecipient(env.recipient):null;
 if(method==='send'?to===null||env.text==='':env.recipient!==LIST_RECIPIENT||env.text!==''||env.replyTo!==undefined)return {status:'envelope_invalid',reason:method==='send'?'recipient_or_text':'listing_shape'};
 // Authentication.
 const roster=await readPeers(d.peersPath);
 if(roster.status==='unusable')return {status:'peers_unusable'};
 const peer=roster.status==='ok'?roster.value.peers.find(p=>p.name===env.sender):undefined;
 if(!peer)return {status:'sender_unregistered'};
 if(peer.revoked)return {status:'key_revoked'};
 if(env.keyVersion!==peer.keyVersion)return {status:'key_version_mismatch'};
 const key=d.env[peer.receiveKeyEnv];
 if(typeof key!=='string'||key==='')return {status:'key_unavailable'};
 // The send key and the receive key are two keys, and no two registrations share one: a shared value would let a signature of one
 // stand for another. The Bot is told only that this Mac has no usable key; the owner is told why.
 const twin=roster.status==='ok'?keyTwin(roster.value,d.env,peer,key):null;
 if(twin){d.diagnose(`keys_not_distinct: ${peer.name} receiveKeyEnv equals ${twin}`);return {status:'key_unavailable'};}
 if(!verifySignature(key,env))return {status:'signature_mismatch'};
 const now=d.now();
 if(!withinWindow(env.signedAt,now))return {status:'timestamp_out_of_window'};
 // Authorization of the registration (needs no destination).
 const allowed=await authorize(d,env.sender,env.keyVersion);
 if(refused(allowed))return {status:allowed.reason};
 // One use per nonce. The record is also the proof of the check that a recipient later shows as "verified".
 let claim;
 try{claim=await claimNonce(d.nonceDir,{peer:peer.name,keyVersion:env.keyVersion,nonce:env.nonce,op:method,id:env.id,recipient:env.recipient,signatureSha256:signatureDigest(env.signature),at:now},now);}
 catch{return {status:'nonce_unavailable'};}
 if(claim.status==='seen')return replay(d,env,claim.record?.signatureSha256===signatureDigest(env.signature));
 if(method==='sessions')return list(d,allowed.peer,allowed.limits);
 return deliver(d,allowed.peer,env,to!);
}
// The same envelope presented again does nothing. If its first delivery never reported a result, say so with the existing
// word for it; otherwise it is a replay.
async function replay(d:ExternalDeps,env:SignedEnvelope,identical:boolean):Promise<unknown>{
 const to=identical?parseRecipient(env.recipient):null;
 if(to){
  // The request this envelope became, if it became one: the reservation of the same id that holds the same content (an id that was
  // used for other content is not this envelope's). Then say what became of it; with no reservation only the nonce was spent.
  try{
   const record=await reservationOf(d.reservationDir,'grok-bot','external',env.sender,env.id);
   const hash=record?await requestHash(d.keyPath,['grok-bot',env.sender,to.provider,to.nativeId,env.replyTo??null,env.text]):null;
   if(record&&record.hash===hash)return ['unknown','pending'].includes(record.status)?{status:'duplicate_of_unknown',requestId:env.id}:{status:'duplicate',requestId:env.id,previous:record.status};
  }catch{}
 }
 return {status:'nonce_replayed'};
}
async function list(d:ExternalDeps,peer:Peer,limits:Limits):Promise<unknown>{
 const found=await d.scan(d.home,'any'),candidates=[];
 for(const n of found.sessions){
  if((n.status??'online')!=='online'||!n.generation||d.rejectedVersion(n,limits)||await d.excluded(n,limits)||!await inRange(d,peer,limits,n.cwd))continue;
  candidates.push({id:`${n.provider}:${n.nativeId}`,provider:n.provider,nativeId:n.nativeId,generation:n.generation,recipient:`${n.provider}:${n.nativeId}:${n.generation}`,cwd:n.cwd,version:n.version||null});
 }
 return {status:'ok',sender:{id:botId(peer.name),keyVersion:peer.keyVersion},candidates};
}
async function deliver(d:ExternalDeps,signer:Peer,env:SignedEnvelope,to:NonNullable<ReturnType<typeof parseRecipient>>):Promise<unknown>{
 // A Grok CLI envelope is handed over whole as additionalContext, so a longer text is refused before anything is reserved.
 if(to.provider==='grok'&&[...env.text].length>8000)return {status:'text_too_long'};
 const named:SessionIdentity={provider:to.provider,nativeId:to.nativeId,generation:to.generation,cwd:'',socket:''};
 // Looked at now and again just before the write: roster, limits, the live conversation and its folder.
 const resolve=async():Promise<{n:NativeIdentity}|Reason>=>{
  const a=await authorize(d,env.sender,env.keyVersion);if(refused(a))return a;
  const n=await d.inspect(named);if(!n)return {reason:'target_offline'};
  if(n.nativeId!==to.nativeId||n.generation!==to.generation)return {reason:'generation_mismatch'};
  if(await d.excluded({provider:to.provider,nativeId:n.nativeId,generation:n.generation,cwd:n.cwd},a.limits))return {reason:'target_excluded'};
  if(!await inRange(d,a.peer,a.limits,n.cwd))return {reason:'scope_conflict'};
  const unsupported=await d.compatibility({provider:to.provider,nativeId:n.nativeId,version:n.version},a.limits);
  return unsupported?{reason:unsupported.status}:{n};
 };
 const first=await resolve();
 if(refused(first))return {status:first.reason};
 const senderId=botId(signer.name),targetId=`${to.provider}:${to.nativeId}`;
 const grants=(peer:string)=>[{peer,operation:'send' as const,direction:'outbound' as const},{peer,operation:'send' as const,direction:'inbound' as const}];
 const sender:Registration={id:senderId,provider:'grok-bot',nativeId:signer.name,generation:String(signer.keyVersion),host:'external',displayName:signer.displayName,workspace:'',operations:['send'],grants:grants(targetId)};
 const target:Registration={id:targetId,provider:to.provider,nativeId:to.nativeId,generation:to.generation,host:'local',displayName:targetId,workspace:first.n.cwd,operations:['send'],grants:grants(senderId)};
 const validate=async()=>{const again=await resolve();return refused(again)?again.reason:again.n.cwd!==first.n.cwd?'workspace_changed':null;};
 // What the Bot was sent earlier is in the reservations; a reply must point at one of them (Delivery checks the rest: the
 // request was addressed to this sender, came from this destination, and is itself not a reply).
 // A request the native side refused ('rejected') never reached the Bot, so it is not one the Bot can answer; one still pending or of
 // unknown result may have.
 const adapter:NativeAdapter={...d.adapter,inbound:async recipient=>(await requests(d.reservationDir)).filter(r=>r.recipient.id===recipient.id&&r.status!=='rejected').map((r):Envelope=>({id:r.id,sender:{id:r.sender.id,nativeId:r.sender.nativeId,generation:r.sender.generation},recipient:{id:recipient.id,nativeId:recipient.nativeId,generation:recipient.generation},text:'',...(r.replyTo?{replyTo:r.replyTo}:{})}))};
 const existed=await reservationOf(d.reservationDir,'grok-bot','external',signer.name,env.id).then(r=>r!==null,()=>false);
 const delivery=new Delivery(new Registry([sender,target]),senderId,adapter,{tracking:{keyPath:d.keyPath,now:d.now},fixedTarget:target,validate,reservationDir:d.reservationDir,holdSubmittedMs:SAME_CONTENT_HOLD_MS});
 const result=await delivery.send({target:targetId,id:env.id,text:env.text,replyTo:env.replyTo,scope:'any_registered'}) as {status:string};
 // A reply to a request that is not in the reservations is not "not yet visible": the reservations are the whole record.
 if(result.status==='reply_target_not_yet_visible')return {status:'invalid_reply'};
 // The id was used before: nothing was written again. Say which it was.
 if(existed&&result.status==='unknown')return {status:'duplicate_of_unknown',requestId:env.id};
 if(existed&&['submitted','rejected'].includes(result.status))return {status:'duplicate',requestId:env.id,previous:result.status};
 return result;
}
