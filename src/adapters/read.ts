import type { Registration } from '../protocol.ts';
import { ContractError } from '../protocol.ts';
export const MAX_READ_LIMIT=100;
export type ReadRole='user'|'assistant'|'peer'|'tool';
export type ReadItem={nativeItemId:string;role:ReadRole;text:string;at:string|null;peer?:{namespace:string;declaredSender?:string;messageId?:string;replyTo?:string;envelope?:Envelope}};
export type Party={id:string;nativeId:string;generation:string};
// Declared bridge data decoded from a native peer record. It is not authenticated identity or human approval.
export type Envelope={id:string;sender:Party;recipient:Party;text:string;replyTo?:string};
export type ReadFailure='not_found'|'generation_mismatch'|'unsupported_version'|'unavailable'|'cursor_invalid';
export type ReadResult={status:'ok'|'empty';target:{id:string;provider:Registration['provider'];nativeId:string;generation:string};items:ReadItem[];nextCursor:string|null;source:string;fetchedAt:string;complete:boolean;olderUnavailable:boolean;omitted:string[]}|{status:ReadFailure;reason:string};
// A provider transcript: every visible item oldest-first, plus the observed generation.
export type Transcript={generation:string;items:ReadItem[];complete:boolean;source:string;omitted:string[]};
export type TranscriptReader=(target:Registration,options:{complete:boolean})=>Promise<Transcript|{status:ReadFailure;reason:string}>;
const str=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=4096;
function party(v:any):Party|null{return v&&typeof v==='object'&&str(v.id)&&str(v.nativeId)&&str(v.generation)?{id:v.id,nativeId:v.nativeId,generation:v.generation}:null;}
// Call only on records the native product already marked as peer origin; never on ordinary user text.
export function parseEnvelope(raw:string):Envelope|null{
 let v;try{v=JSON.parse(raw);}catch{return null;}
 if(!v||typeof v!=='object'||v.schemaVersion!==1||(Object.hasOwn(v,'humanApproval')&&v.humanApproval!==false)||!str(v.id)||typeof v.text!=='string'||v.replyTo!==undefined&&!str(v.replyTo))return null;
 const sender=party(v.sender),recipient=party(v.recipient);if(!sender||!recipient)return null;
 return {id:v.id,sender,recipient,text:v.text,...(v.replyTo===undefined?{}:{replyTo:v.replyTo})};
}
export type ReadOptions={cursor?:string;limit?:number};
type Cursor={p:string;n:string;g:string;b:string};
function encode(c:Cursor){return Buffer.from(JSON.stringify(c)).toString('base64url');}
function decode(raw:string):Cursor|null{
 try{const c=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));return c&&typeof c==='object'&&['p','n','g','b'].every(k=>typeof c[k]==='string'&&c[k])?c:null;}catch{return null;}
}
export function parseReadOptions(value:unknown):ReadOptions{
 if(value===undefined)return {};
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>k!=='cursor'&&k!=='limit'))throw new ContractError();
 const v=value as ReadOptions;
 if(v.cursor!==undefined&&(typeof v.cursor!=='string'||!v.cursor||v.cursor.length>1024))throw new ContractError();
 if(v.limit!==undefined&&(!Number.isInteger(v.limit)||v.limit<1||v.limit>MAX_READ_LIMIT))throw new ContractError();
 return v;
}
// Newest page first; nextCursor walks toward older items. Absence and emptiness stay distinct.
export function createReader(readers:Partial<Record<Registration['provider'],TranscriptReader>>,clock:()=>number=Date.now){
 return async(target:Registration,options:ReadOptions={}):Promise<ReadResult>=>{
  const {cursor,limit=20}=parseReadOptions(options),reader=readers[target.provider];
  if(!reader)return {status:'unavailable',reason:'reader_missing'};
  const anchor=cursor===undefined?null:decode(cursor);
  if(cursor!==undefined&&(!anchor||anchor.p!==target.provider||anchor.n!==target.nativeId))return {status:'cursor_invalid',reason:'cursor_target'};
  let transcript=await reader(target,{complete:false});
  for(let attempt=0;;attempt++){
   if('status' in transcript)return transcript;
   if(transcript.generation!==target.generation||anchor&&anchor.g!==transcript.generation)return {status:'generation_mismatch',reason:'generation'};
   const items=transcript.items,end=anchor?items.findIndex(x=>x.nativeItemId===anchor.b):items.length;
   // end<=limit reaches the oldest loaded item; an incomplete load may still have older history.
   if((end<0||end<=limit)&&!transcript.complete&&attempt===0){transcript=await reader(target,{complete:true});continue;}
   if(end<0)return {status:'cursor_invalid',reason:'anchor_missing'};
   const start=Math.max(0,end-limit),page=items.slice(start,end);
   return {status:items.length?'ok':'empty',target:{id:target.id,provider:target.provider,nativeId:target.nativeId,generation:transcript.generation},items:page,
    nextCursor:start>0?encode({p:target.provider,n:target.nativeId,g:transcript.generation,b:items[start]!.nativeItemId}):null,
    source:transcript.source,fetchedAt:new Date(clock()).toISOString(),complete:transcript.complete,olderUnavailable:start===0&&!transcript.complete,omitted:transcript.omitted};
  }
 };
}
