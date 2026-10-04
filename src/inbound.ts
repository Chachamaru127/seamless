import type {Registration} from './protocol.ts';
import type {Envelope,ReadItem} from './adapters/read.ts';
import {DAY} from './request-store.ts';
export type Received={id:string;sender:Envelope['sender'];recipient:Envelope['recipient'];at:string|null};
export function receivedMetadata(items:ReadItem[]):Received[]{
 return items.flatMap(item=>item.role==='peer'&&item.peer?.envelope?[{id:item.peer.envelope.id,sender:item.peer.envelope.sender,recipient:item.peer.envelope.recipient,at:item.at}]:[]);
}
export async function verifyInbound(options:{caller:Registration;received:Received[];targets:Registration[];now:number;canRead:(target:Registration)=>Promise<boolean>;sentIds?:(target:Registration,ids:string[],recipient:Pick<Registration,'provider'|'nativeId'>)=>Promise<string[]>}){
 const c=options.caller,seen=new Set<string>();
 const recent=options.received.filter(r=>r.recipient.id===c.id&&r.recipient.nativeId===c.nativeId&&r.recipient.generation===c.generation&&r.at!==null&&Date.parse(r.at)<=options.now&&options.now-Date.parse(r.at)<=DAY).sort((a,b)=>Date.parse(b.at!)-Date.parse(a.at!)).filter(r=>{const key=JSON.stringify([r.id,r.sender]);if(seen.has(key))return false;seen.add(key);return true;}).slice(0,10);
 const result=[];
 for(const r of recent){
  const target=options.targets.find(t=>t.id===r.sender.id&&t.nativeId===r.sender.nativeId&&t.generation===r.sender.generation);
  let verified=false;
  try{if(target&&options.sentIds&&await options.canRead(target))verified=(await options.sentIds(target,[r.id],c)).includes(r.id);}catch{}
  result.push({id:r.id,from:{id:r.sender.id,nativeId:r.sender.nativeId,generation:r.sender.generation},sender:verified?'verified' as const:'declared' as const,at:r.at});
 }
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
