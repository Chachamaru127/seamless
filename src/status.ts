import {ContractError,type Registration} from './protocol.ts';
import {requests,DAY,type RequestRecord,type RequestParty} from './request-store.ts';
import type {NativeAdapter} from './delivery.ts';
export type StructureItem={id:string;type:string;at:string|null;payloadSha256?:string;turnId?:string;position?:number;parentUuid?:string|null;peer?:{id:string;replyTo?:string;sender?:{provider:string;nativeId:string}}};
export type Stage={stage:'accepted'|'reached'|'processing'|'replied'|'unknown';status:'observed'|'unobserved';evidence:string[];at:string|null};
export type StatusClock={now:()=>number;sleep:(ms:number)=>Promise<void>};
const clock:StatusClock={now:Date.now,sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms))};
const registration=(p:RequestParty):Registration=>({id:p.id,provider:p.provider,nativeId:p.nativeId,generation:p.generation,workspace:p.cwd,host:'local',displayName:p.id,operations:['read'],grants:[]});
export function stages(record:RequestRecord,destination:StructureItem[],source:StructureItem[],now:number):Stage[]{
 const observedAt=new Date(now).toISOString();
 const result:Stage[]=['accepted','reached','processing','replied','unknown'].map(stage=>({stage:stage as Stage['stage'],status:'unobserved',evidence:[],at:null}));
 const mark=(stage:Stage['stage'],evidence:string[],at:string|null=observedAt)=>{Object.assign(result.find(s=>s.stage===stage)!,{status:'observed',evidence,at:at??observedAt});};
 if(record.status==='submitted')mark('accepted',['reservation:submitted'],new Date(record.at).toISOString());
 if(['unknown','pending'].includes(record.status))mark('unknown',['reservation:'+record.status]);
 const dest=destination.slice(-200),src=source.slice(-200),peers=dest.filter(n=>n.peer?.id===record.id&&n.peer.sender?.provider===record.sender.provider&&n.peer.sender.nativeId===record.sender.nativeId);
 if(peers.length){mark('reached',peers.map(n=>n.id),peers[0].at);
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
  if(queued)mark('reached',['queued:'+queued.id],queued.at);
 }
 const reply=src.find(n=>n.peer?.replyTo===record.id&&n.peer.sender?.provider===record.recipient.provider&&n.peer.sender.nativeId===record.recipient.nativeId);if(reply)mark('replied',[reply.id],reply.at);
 return result;
}
export function statusResult(record:RequestRecord,destination:StructureItem[],source:StructureItem[],now:number){
 return {status:'ok' as const,id:record.id,delivery:record.status,target:{provider:record.recipient.provider,nativeId:record.recipient.nativeId,generation:record.recipient.generation},at:new Date(record.at).toISOString(),stages:stages(record,destination,source,now)};
}
export function createStatus(options:{parallelReads?:boolean;dir:string;adapter:NativeAdapter;caller:RequestParty;canRead:(p:RequestParty)=>Promise<boolean>;clock?:StatusClock}){
 const time=options.clock??clock;
 const owned=(r:RequestRecord)=>r.sender.provider===options.caller.provider&&r.sender.nativeId===options.caller.nativeId&&r.sender.generation===options.caller.generation;
 const read=async(p:RequestParty):Promise<StructureItem[]>=>{
  if(!await options.canRead(p))return [];
  try{return options.adapter.structure?(await options.adapter.structure(registration(p))).slice(-200):[];}catch{return [];}
 };
 const once=async(id:string)=>{
  const record=(await requests(options.dir)).find(r=>r.id===id&&owned(r));if(!record)return {status:'not_found' as const};
  const [destination,source]=options.parallelReads?await Promise.all([read(record.recipient),read(record.sender)]):[await read(record.recipient),await read(record.sender)];
  return statusResult(record,destination,source,time.now());
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
