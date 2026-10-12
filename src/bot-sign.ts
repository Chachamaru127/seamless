import {createHmac,randomBytes} from 'node:crypto';
import {readPeers} from './peers.ts';
import {signingInput,LIST_RECIPIENT,type SignedEnvelope} from './signed-envelope.ts';
import type {SecretReader} from './secrets.ts';
import type {ExecutorCheck} from './bot-executor.ts';

// Signing on this Mac for a registered outside sender (`seamless bot-send|bot-sessions <registration>`, src/cli.ts).
// MVP stand-in, not the design: the design signs on the Bot's side and this Mac only verifies (src/signed-envelope.ts). Until then,
// only a command the Grok Bot app runs for this Bot is signed (src/bot-executor.ts); another Bot of the same app could still pass
// itself off by setting the Bot's UUID. Before distribution, go back to signing on the Bot's side and delete this file.
// What it makes is exactly the envelope the Bot would make (the nine lines of src/signed-envelope.ts, HMAC-SHA256 with the
// registration's receive key, a fresh random nonce, the roster's key version, this Mac's clock). It is handed whole to externalCall,
// so every check a Bot's envelope goes through applies to it unchanged, with one difference it cannot hide: its nonce records say
// signedBy:'mac' (src/nonce-store.ts), so the recipient sees such a message as declared, never as verified.
// executor says whether the Bot itself runs this command (src/bot-executor.ts, 立花さんの判断 1). No key is read for anyone else.
export type BotSigning={name:string;peersPath:string;secret:SecretReader;now:()=>number;executor:ExecutorCheck};
export type Signed={envelope:SignedEnvelope}|{result:{status:string;reason?:string}};
// replyToken is the word a reply gives back (src/bot-executor.ts); it is looked at before signing and is not part of what is signed.
const FIELDS=['recipient','id','replyTo','text','replyToken'];
const isoSeconds=(ms:number)=>new Date(Math.floor(ms/1000)*1000).toISOString().slice(0,19)+'Z';
// What the person gives for a send: the four fields of a request, as JSON. The sender, key version, time, nonce and signature are
// made here, never taken from the input.
function request(input:unknown):{recipient:string;id:string;replyTo?:string;text:string;replyToken?:string}|{reason:string}{
 if(!input||typeof input!=='object'||Array.isArray(input))return {reason:'shape'};
 const v=input as Record<string,unknown>;
 for(const k of Object.keys(v))if(!FIELDS.includes(k))return {reason:'unknown_field'};
 for(const k of ['recipient','id','text'])if(typeof v[k]!=='string')return {reason:k};
 if(v.replyTo!==undefined&&typeof v.replyTo!=='string')return {reason:'replyTo'};
 if(v.replyToken!==undefined&&typeof v.replyToken!=='string')return {reason:'replyToken'};
 return {recipient:v.recipient as string,id:v.id as string,...(v.replyTo===undefined?{}:{replyTo:v.replyTo as string}),text:v.text as string,...(v.replyToken===undefined?{}:{replyToken:v.replyToken as string})};
}
export async function signForBot(d:BotSigning,method:'send'|'sessions',input:unknown):Promise<Signed>{
 const asked=method==='sessions'?{recipient:LIST_RECIPIENT,id:`list-${randomBytes(8).toString('hex')}`,text:''}:request(input);
 if('reason' in asked)return {result:{status:'envelope_invalid',reason:asked.reason}};
 const roster=await readPeers(d.peersPath);
 if(roster.status==='unusable')return {result:{status:'peers_unusable'}};
 const peer=roster.status==='ok'?roster.value.peers.find(p=>p.name===d.name):undefined;
 if(!peer)return {result:{status:'sender_unregistered'}};
 const {replyToken,...toSign}=asked as typeof asked&{replyToken?:string};
 const refused=await d.executor(peer,replyToken===undefined?undefined:{replyTo:toSign.replyTo,recipient:toSign.recipient,replyToken});
 if(refused)return {result:{status:'executor_unverified',reason:refused}};
 const key=await d.secret(peer.receiveKeyEnv);
 if(key===undefined)return {result:{status:'key_unavailable'}};
 const fields={sender:peer.name,keyVersion:peer.keyVersion,...toSign,signedAt:isoSeconds(d.now()),nonce:randomBytes(16).toString('base64url')};
 return {envelope:{...fields,signature:createHmac('sha256',key).update(signingInput(fields)).digest('hex')}};
}
