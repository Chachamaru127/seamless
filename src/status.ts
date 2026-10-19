import {ContractError,type Registration} from './protocol.ts';
import {requests,DAY,isLocalParty,type RequestRecord,type RequestParty,type LocalParty} from './request-store.ts';
import {REACHED_STAGE,STAGE_ORDER,type StageName} from './adapters/read.ts';
import {DEFAULT_HELD_AFTER_SEC} from './limits.ts';
import type {NativeAdapter} from './delivery.ts';
import {claudeInboundHolds} from './adapters/claude.ts';
import {observeCodexGoal} from './adapters/codex.ts';
export type StructureItem={id:string;type:string;at:string|null;payloadSha256?:string;turnId?:string;position?:number;parentUuid?:string|null;generation?:string;hookName?:string|null;hooks?:string[];peer?:{id:string;replyTo?:string;sender?:{provider:string;nativeId:string}}};
export type Stage={stage:StageName;status:'observed'|'unobserved';evidence:string[];at:string|null};
// A state is not a stage (spec.md 用語): `held` waits for a peer record that stays silent, `read_failed` cannot open that
// record at all, and `refused` means the official path turned the write down before it was accepted.
export type DeliveryState={state:'held'|'read_failed'|'refused';reason:string};
export type StatusClock={now:()=>number;sleep:(ms:number)=>Promise<void>};
const clock:StatusClock={now:Date.now,sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms))};
const registration=(p:LocalParty):Registration=>({id:p.id,provider:p.provider,nativeId:p.nativeId,generation:p.generation,workspace:p.cwd,host:'local',displayName:p.id,operations:['read'],grants:[]});
export function stages(record:RequestRecord,destination:StructureItem[],source:StructureItem[],now:number):Stage[]{
 const observedAt=new Date(now).toISOString();
 const result:Stage[]=STAGE_ORDER.map(stage=>({stage,status:'unobserved',evidence:[],at:null}));
 const mark=(stage:Stage['stage'],evidence:string[],at:string|null=observedAt)=>{Object.assign(result.find(s=>s.stage===stage)!,{status:'observed',evidence,at:at??observedAt});};
 // A registered outside executor (grok-bot) has no conversation here to look into: delivery and processing can never be observed, only
 // the HTTP answer (accepted) and its own reply (replied). Both stay unobserved, and this says it is not a matter of waiting.
 if(record.recipient.provider==='grok-bot')for(const s of result)if(s.stage===REACHED_STAGE||s.stage==='processing')s.evidence=['external_executor'];
 if(record.status==='submitted')mark('accepted',['reservation:submitted'],new Date(record.at).toISOString());
 if(['unknown','pending'].includes(record.status))mark('unknown',['reservation:'+record.status]);
 const dest=destination.slice(-200),src=source.slice(-200);
 // Grok CLI (specs/202610-more-peers Plans.md, "配信確認"): reached needs both the hook's receipt for this request and
 // generation, and Grok's own record of that hook succeeding at the Stop right after it (before the next user turn).
 // The first such Stop is the hook's own run: handing over text makes Grok continue the turn, and the continuation's
 // Stop is a later row. Processing is the agent's first message or tool call after that Stop.
 if(record.recipient.provider==='grok'){
  const receipt=dest.find(n=>n.type==='grok-receipt'&&n.peer?.id===record.id&&n.peer.sender?.provider===record.sender.provider&&n.peer.sender.nativeId===record.sender.nativeId&&n.generation===record.recipient.generation);
  if(receipt?.at&&receipt.hookName){
   const t=Date.parse(receipt.at),after=dest.filter(n=>n.at!==null&&Date.parse(n.at)>=t&&n!==receipt);
   // Grok also records what the hook handed over (hook_annotation), with this request's id in seamless's envelope line.
   let hook:StructureItem|undefined,note:StructureItem|undefined;
   for(const n of after){if(n.type==='user')break;if(n.type==='hook_stop'){if(n.hooks?.includes(receipt.hookName))hook=n;break;}}
   if(hook)for(const n of after){if(Date.parse(n.at!)<Date.parse(hook.at!))continue;if(n.type==='user')break;if(n.type==='hook_note'){if(n.peer?.id===record.id&&n.peer.sender?.provider===record.sender.provider&&n.peer.sender.nativeId===record.sender.nativeId)note=n;break;}}
   if(hook&&note){mark(REACHED_STAGE,[receipt.id,hook.id,note.id],hook.at);
    const proof=after.find(n=>(n.type==='assistant'||n.type==='tool')&&Date.parse(n.at!)>Date.parse(hook!.at!));
    if(proof)mark('processing',[hook.id,proof.id],proof.at);}
  }
 }
 const peers=record.recipient.provider==='grok'?[]:dest.filter(n=>n.type!=='enqueue'&&n.peer?.id===record.id&&n.peer.sender?.provider===record.sender.provider&&n.peer.sender.nativeId===record.sender.nativeId);
 if(peers.length){mark(REACHED_STAGE,peers.map(n=>n.id),peers[0].at);
  for(const peer of peers){
   let proof:StructureItem|undefined;
   if(record.recipient.provider==='codex')proof=dest.find(n=>peer.turnId!==undefined&&n.turnId===peer.turnId&&peer.position!==undefined&&n.position!==undefined&&n.position>peer.position);
   else{
    const byId=new Map(dest.map(n=>[n.id,n]));
    proof=dest.find(n=>{if(n.type!=='assistant')return false;const seen=new Set<string>();let parent=n.parentUuid;while(parent&&!seen.has(parent)){if(parent===peer.id)return true;seen.add(parent);parent=byId.get(parent)?.parentUuid;}return false;});
   }
   if(proof){mark('processing',[peer.id,proof.id],proof.at);break;}
  }
 }
 if(!peers.length&&record.recipient.provider==='claude'&&record.payloadSha256){
  const queued=dest.find(n=>n.type==='enqueue'&&n.payloadSha256===record.payloadSha256);
  if(queued)mark(REACHED_STAGE,['queued:'+queued.id],queued.at);
 }
 // Claude enqueue lines count here: the reply is correlated by replyTo and by the recipient's identity, not by origin.
 const reply=src.find(n=>n.peer?.replyTo===record.id&&n.peer.sender?.provider===record.recipient.provider&&n.peer.sender.nativeId===record.recipient.nativeId);if(reply)mark('replied',[reply.id],reply.at);
 return result;
}
export function statusResult(record:RequestRecord,destination:StructureItem[],source:StructureItem[],now:number,inbox?:string|null){
 // For Grok CLI: where the envelope is in the inbox, and when the peer's record last moved (the band says when it is idle).
 const peerActive=record.recipient.provider==='grok'?destination.reduce<string|null>((a,n)=>n.type!=='grok-receipt'&&n.at&&(!a||n.at>a)?n.at:a,null):undefined;
 return {status:'ok' as const,id:record.id,delivery:record.status,target:{provider:record.recipient.provider,nativeId:record.recipient.nativeId,generation:record.recipient.generation},at:new Date(record.at).toISOString(),stages:stages(record,destination,source,now),...(inbox!==undefined?{inbox}:{}),...(peerActive!==undefined?{peerActiveAt:peerActive}:{})};
}
export type ReadOutcome={items:StructureItem[];readable:boolean;attempted:boolean};
// The product's own reason for waiting is attached only when the receiving side was observed to hold: Claude's inbound
// setting (or a bypass permission mode), Codex Desktop's own goal record. No observation, including a failed read, is
// unknown_reason. A state is separate from the five stages: refused comes from the reservation, read_failed from opening
// the peer's record, and held only after that record was readable and stayed silent past the configured wait.
export type HoldObservation=(target:Registration)=>Promise<boolean|null>;
async function deliveryState(record:RequestRecord,read:ReadOutcome,result:ReturnType<typeof statusResult>,now:number,holdMs:number,reason:(p:LocalParty)=>Promise<string>):Promise<Partial<DeliveryState>>{
 if(record.status==='rejected')return {state:'refused',reason:record.reason??'refused_by_peer'};
 if(record.status!=='submitted'||!isLocalParty(record.recipient))return {};
 if(read.attempted&&!read.readable)return {state:'read_failed',reason:'record_unreadable'};
 if(!read.readable)return {};
 if(result.stages.some(s=>s.status==='observed'&&(s.stage===REACHED_STAGE||s.stage==='processing'||s.stage==='replied')))return {};
 if(now-record.at<holdMs)return {};
 return {state:'held',reason:await reason(record.recipient)};
}
export function createStatus(options:{parallelReads?:boolean;dir:string;adapter:NativeAdapter;caller:RequestParty;canRead:(p:RequestParty)=>Promise<boolean>;clock?:StatusClock;heldAfterSec?:number;home?:string;claudeHold?:HoldObservation;codexGoal?:HoldObservation}){
 const time=options.clock??clock,holdMs=(options.heldAfterSec??DEFAULT_HELD_AFTER_SEC)*1000;
 const owned=(r:RequestRecord)=>r.sender.provider===options.caller.provider&&r.sender.nativeId===options.caller.nativeId&&r.sender.generation===options.caller.generation;
 // Only an observed hold names the product reason; a failed or absent observation is unknown_reason, never a guess from the name.
 const observedHold=async(target:Registration,observe:HoldObservation):Promise<boolean>=>{try{return await observe(target)===true;}catch{return false;}};
 const holdReason=async(p:LocalParty):Promise<string>=>{
  const target=registration(p);
  if(p.provider==='claude')return await observedHold(target,options.claudeHold??(()=>claudeInboundHolds({home:options.home})))?'claude_hold':'unknown_reason';
  if(p.provider==='codex')return await observedHold(target,options.codexGoal??(t=>observeCodexGoal(t.nativeId)))?'codex_goal':'unknown_reason';
  return 'unknown_reason';
 };
 // attempted=false means this call never opened the record (no permission, no reader): silence there proves nothing.
 const read=async(p:RequestParty):Promise<ReadOutcome>=>{
  if(!isLocalParty(p)||!await options.canRead(p))return {items:[],readable:false,attempted:false};
  if(!options.adapter.structure)return {items:[],readable:false,attempted:false};
  try{return {items:(await options.adapter.structure(registration(p))).slice(-200),readable:true,attempted:true};}catch{return {items:[],readable:false,attempted:true};}
 };
 // A registered outside executor answers through the signed receiving path (src/external-inbound.ts), which leaves the reservation of
 // its envelope: that, not a line in the sender's own conversation that merely says so, is what shows it replied. Only an answer the
 // Mac accepted counts (not one refused, pending or of unknown result), from this executor, aimed at the conversation that asked.
 const botReplies=(record:RequestRecord,all:RequestRecord[]):StructureItem[]=>all.filter(r=>r.status==='submitted'&&r.replyTo===record.id&&r.sender.provider==='grok-bot'&&r.sender.nativeId===record.recipient.nativeId&&r.recipient.provider===record.sender.provider&&r.recipient.nativeId===record.sender.nativeId&&r.recipient.generation===record.sender.generation)
  .map(r=>({id:r.id,type:'reply',at:new Date(r.at).toISOString(),peer:{id:r.id,replyTo:record.id,sender:{provider:'grok-bot',nativeId:r.sender.nativeId}}}));
 const once=async(id:string)=>{
  const all=await requests(options.dir),record=all.find(r=>r.id===id&&owned(r));if(!record)return {status:'not_found' as const};
  const own=async():Promise<StructureItem[]>=>record.recipient.provider==='grok-bot'?botReplies(record,all):(await read(record.sender)).items;
  // An outside executor has no conversation here; a local one is opened through its evidence reader, and whether that
  // opened at all is what separates `read_failed` from `held`.
  const destinationRead=async():Promise<ReadOutcome>=>record.recipient.provider==='grok-bot'?{items:[],readable:false,attempted:false}:read(record.recipient);
  const [destination,source]:[ReadOutcome,StructureItem[]]=options.parallelReads?await Promise.all([destinationRead(),own()]):[await destinationRead(),await own()];
  const inbox=isLocalParty(record.recipient)&&record.recipient.provider==='grok'&&options.adapter.inboxState&&await options.canRead(record.recipient)?await options.adapter.inboxState(registration(record.recipient),record.id,{id:record.sender.id,nativeId:record.sender.nativeId}).catch(()=>null):undefined;
  const now=time.now(),result=statusResult(record,destination.items,source,now,inbox);
  return {...result,...await deliveryState(record,destination,result,now,holdMs,holdReason)};
 };
 return {
  async track(id:unknown,waitSeconds:unknown=0){
   if(typeof id!=='string'||!id||id.length>256||typeof waitSeconds!=='number'||!Number.isFinite(waitSeconds)||waitSeconds<0||waitSeconds>600)throw new ContractError();
   const deadline=time.now()+waitSeconds*1000;
   for(;;){const result=await once(id);if(result.status!=='ok'||result.stages?.some(s=>s.stage==='replied'&&s.status==='observed')||waitSeconds===0)return result;
    if(time.now()>=deadline)return {...result,status:'wait_limit',processingCancelled:false};
    await time.sleep(Math.min(30000,deadline-time.now()));
   }
  },
  async recent(target:RequestParty){const now=time.now();const records=(await requests(options.dir)).filter(r=>owned(r)&&r.recipient.provider===target.provider&&r.recipient.nativeId===target.nativeId&&r.at<=now&&now-r.at<=DAY).sort((a,b)=>b.at-a.at).slice(0,10);return Promise.all(records.map(r=>once(r.id)));}
 };
}
