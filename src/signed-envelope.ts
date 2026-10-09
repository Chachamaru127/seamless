import {createHash,createHmac,timingSafeEqual} from 'node:crypto';

// Bot -> Mac (specs/202610-more-peers T2-3). The Bot signs an envelope with the registration's RECEIVE key; this Mac only verifies.
// There is deliberately no signing function here: nothing in seamless can sign with a Mac-held key.
//
// What is signed (one string, UTF-8, the nine lines joined by "\n", no trailing newline):
//   seamless-inbound-v1
//   <sender: registration name>
//   <keyVersion: decimal integer>
//   <recipient: "claude|codex|grok:<conversation id>:<generation>", or "*" for a listing request>
//   <id: request id>
//   <replyTo, or an empty line when the envelope has none>
//   <lowercase hex SHA-256 of the UTF-8 bytes of text>
//   <signedAt: UTC seconds, YYYY-MM-DDTHH:MM:SSZ>
//   <nonce>
// The signature is the lowercase hex HMAC-SHA256 of that string; the key is the UTF-8 bytes of the environment variable's value.
// No signed field may contain a control character, so a line break can only be the separator, nor a lone surrogate.
export const SIGNING_TAG='seamless-inbound-v1';
export const WINDOW_MS=5*60_000;
export const LIST_RECIPIENT='*';
export const MAX_TEXT_BYTES=32768;
export type SignedEnvelope={sender:string;keyVersion:number;recipient:string;id:string;replyTo?:string;text:string;signedAt:string;nonce:string;signature:string};
export type SignedFields=Omit<SignedEnvelope,'signature'>;
export type ParsedEnvelope={ok:true;envelope:SignedEnvelope}|{ok:false;reason:string};
export type Recipient={provider:'claude'|'codex'|'grok';nativeId:string;generation:string};
const KEYS=['sender','keyVersion','recipient','id','replyTo','text','signedAt','nonce','signature'];
const SENDER=/^[a-z0-9-]{1,63}$/,NONCE=/^[A-Za-z0-9_-]{16,128}$/,SIGNATURE=/^[0-9a-f]{64}$/,SIGNED_AT=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,NATIVE_ID=/^[A-Za-z0-9._-]{1,128}$/;
// A lone surrogate cannot be encoded as UTF-8: Buffer and the HMAC would both turn it into U+FFFD, so a text with U+FFFD and the same text
// with a lone surrogate would carry one signature. Neither is accepted in a signed field (a surrogate pair is one code point and is fine).
const LONE_SURROGATE=/\p{Surrogate}/u;
const plain=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length>=1&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v)&&!LONE_SURROGATE.test(v);
const sha256=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export const sha256Hex=(text:string)=>sha256(Buffer.from(text,'utf8'));
// signedAt is whole UTC seconds and a real calendar time (2026-02-31 is not one).
function parseSignedAt(value:string):number|null{
 if(!SIGNED_AT.test(value))return null;
 const ms=Date.parse(value);
 return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,19)+'Z'===value?ms:null;
}
export function parseSignedEnvelope(raw:unknown):ParsedEnvelope{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return {ok:false,reason:'shape'};
 const v=raw as Record<string,unknown>;
 for(const k of Object.keys(v))if(!KEYS.includes(k))return {ok:false,reason:'unknown_field'};
 // Absent and undefined are the same; null and an empty string are not "no replyTo".
 const bad=(k:string)=>({ok:false as const,reason:k});
 if(typeof v.sender!=='string'||!SENDER.test(v.sender))return bad('sender');
 if(!Number.isSafeInteger(v.keyVersion)||(v.keyVersion as number)<1)return bad('keyVersion');
 if(!plain(v.recipient,1024))return bad('recipient');
 if(!plain(v.id,256))return bad('id');
 if(v.replyTo!==undefined&&!plain(v.replyTo,256))return bad('replyTo');
 if(typeof v.text!=='string'||LONE_SURROGATE.test(v.text)||Buffer.byteLength(v.text)>MAX_TEXT_BYTES)return bad('text');
 if(typeof v.signedAt!=='string'||parseSignedAt(v.signedAt)===null)return bad('signedAt');
 if(typeof v.nonce!=='string'||!NONCE.test(v.nonce))return bad('nonce');
 if(typeof v.signature!=='string'||!SIGNATURE.test(v.signature))return bad('signature');
 return {ok:true,envelope:{sender:v.sender,keyVersion:v.keyVersion as number,recipient:v.recipient,id:v.id,...(v.replyTo===undefined?{}:{replyTo:v.replyTo}),text:v.text,signedAt:v.signedAt,nonce:v.nonce,signature:v.signature}};
}
// "claude:<id>:<generation>". The id has no colon; the generation is everything after the second colon (a Grok generation
// can hold one). Anything else, including a conversation of an unknown product, is not a destination.
export function parseRecipient(value:string):Recipient|null{
 const first=value.indexOf(':'),second=first<0?-1:value.indexOf(':',first+1);
 if(first<0||second<0)return null;
 const provider=value.slice(0,first),nativeId=value.slice(first+1,second),generation=value.slice(second+1);
 if(provider!=='claude'&&provider!=='codex'&&provider!=='grok'||!NATIVE_ID.test(nativeId)||!plain(generation,256))return null;
 return {provider,nativeId,generation};
}
export function signingInput(f:SignedFields):string{
 return [SIGNING_TAG,f.sender,String(f.keyVersion),f.recipient,f.id,f.replyTo??'',sha256Hex(f.text),f.signedAt,f.nonce].join('\n');
}
// Constant-time comparison of the claimed MAC with the one computed from the key.
export function verifySignature(key:string,envelope:SignedEnvelope):boolean{
 const expected=createHmac('sha256',key).update(signingInput(envelope)).digest();
 const given=Buffer.from(envelope.signature,'hex');
 return given.length===expected.length&&timingSafeEqual(given,expected);
}
// Inside plus or minus five minutes of this Mac's clock, the edges included.
export function withinWindow(signedAt:string,now:number):boolean{
 const at=parseSignedAt(signedAt);
 return at!==null&&Math.abs(at-now)<=WINDOW_MS;
}
export const signatureDigest=(signature:string)=>sha256(signature);
