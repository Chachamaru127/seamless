import type {Registration} from './protocol.ts';
import type {Envelope,ReadItem} from './adapters/read.ts';
import {DAY} from './request-store.ts';
export type Received={id:string;sender:Envelope['sender'];recipient:Envelope['recipient'];at:string|null};
export function receivedMetadata(items:ReadItem[]):Received[]{
 return items.flatMap(item=>item.role==='peer'&&item.peer?.envelope?[{id:item.peer.envelope.id,sender:item.peer.envelope.sender,recipient:item.peer.envelope.recipient,at:item.at}]:[]);
}
export async function verifyInbound(options:{parallel?:boolean;caller:Registration;received:Received[];targets:Registration[];now:number;canRead:(target:Registration)=>Promise<boolean>;sentIds?:(target:Registration,ids:string[],recipient:Pick<Registration,'provider'|'nativeId'>)=>Promise<string[]>;signed?:(received:Received)=>Promise<boolean>}){
 const c=options.caller,seen=new Set<string>();
 const recent=options.received.filter(r=>r.recipient.id===c.id&&r.recipient.nativeId===c.nativeId&&r.recipient.generation===c.generation&&r.at!==null&&Date.parse(r.at)<=options.now&&options.now-Date.parse(r.at)<=DAY).sort((a,b)=>Date.parse(b.at!)-Date.parse(a.at!)).filter(r=>{const key=JSON.stringify([r.id,r.sender]);if(seen.has(key))return false;seen.add(key);return true;}).slice(0,10);
 if(!options.parallel){
  const result=[];
  for(const r of recent){
   const target=options.targets.find(t=>t.id===r.sender.id&&t.nativeId===r.sender.nativeId&&t.generation===r.sender.generation);
   let verified=false;
   try{if(target&&options.sentIds&&await options.canRead(target))verified=(await options.sentIds(target,[r.id],c)).includes(r.id);else if(!target&&options.signed)verified=await options.signed(r);}catch{}
   result.push({id:r.id,from:{id:r.sender.id,nativeId:r.sender.nativeId,generation:r.sender.generation},sender:verified?'verified' as const:'declared' as const,at:r.at});
  }
  return result;
 }
 const groups=new Map<Registration,Received[]>();
 const targetFor=(r:Received)=>options.targets.find(t=>t.id===r.sender.id&&t.nativeId===r.sender.nativeId&&t.generation===r.sender.generation);
 for(const r of recent){const target=targetFor(r);if(target)groups.set(target,[...(groups.get(target)??[]),r]);}
 const verified=new Map<Registration,Set<string>>();
 const check=async([target,items]:[Registration,Received[]])=>{
  try{if(options.sentIds&&await options.canRead(target))verified.set(target,new Set(await options.sentIds(target,items.map(r=>r.id),c)));}catch{}
 };
 await Promise.all([...groups].map(check));
 // A sender with no conversation here (a registered outside sender) is verified by the record of its signature check, not by a transcript.
 const signed=new Set<Received>();
 if(options.signed)for(const r of recent)if(!targetFor(r)){try{if(await options.signed(r))signed.add(r);}catch{}}
 const result=recent.map(r=>({id:r.id,from:{id:r.sender.id,nativeId:r.sender.nativeId,generation:r.sender.generation},sender:verified.get(targetFor(r)!)?.has(r.id)||signed.has(r)?'verified' as const:'declared' as const,at:r.at}));
 return result;
}

export type SendRecipient=Pick<Registration,'provider'|'nativeId'>;
export function sentTo(input:unknown,recipient:SendRecipient):boolean{
 if(!input||typeof input!=='object'||Array.isArray(input))return false;
 const args=input as Record<string,unknown>;
 if(typeof args.ticket==='string'){
  try{const ticket=JSON.parse(Buffer.from(args.ticket,'base64url').toString('utf8'));return ticket?.provider===recipient.provider&&ticket?.nativeId===recipient.nativeId;}catch{return false;}
 }
 return args.target===`${recipient.provider}:${recipient.nativeId}`;
}
