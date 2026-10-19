import {constants} from 'node:fs';
import {mkdir,open,link,unlink,rename,readdir,lstat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
// The inbox for one Grok CLI conversation (specs/202610-more-peers Plans.md, "配送"). seamless puts an envelope in pending/;
// the Stop hook of that conversation's own TUI moves one envelope per Stop through handed/ to delivered/.
// Every move is a rename inside one directory tree, so an envelope is in exactly one state at a time.
//   pending    accepted by seamless, not yet taken by a hook
//   handed     taken by a hook (file name carries the hook's pid) and being returned to Grok. The hook replaces the
//              envelope's content with its receipt before the last rename, so a hook that dies after handing over but
//              before writing the receipt leaves a body in unknown/; one that dies later leaves only a receipt here.
//   delivered  the hook wrote its receipt (request id, sender, recipient, conversation, generation, hook time, Stop reason,
//              hook name). The receipt carries the request's metadata only: once an envelope is delivered, its text is
//              removed from the inbox and is not kept anywhere under ~/.seamless (spec.md, "持たないもの").
//   failed     the envelope could not be read, or is not this conversation's; the next one is delivered instead
//   unknown    a handed envelope whose hook died; shown as "成否不明" and never delivered again
export const STATES=['pending','handed','delivered','failed','unknown'] as const;
export type InboxState=typeof STATES[number];
export const MAX_GROK_TEXT=8000;
export type GrokEnvelope={schemaVersion:1;id:string;sender:{id:string;nativeId:string;generation:string};recipient:{id:string;nativeId:string;generation:string};text:string;replyTo?:string;humanApproval?:false;acceptedAt:number};
// What a delivered request leaves behind: everything needed to prove that it reached this conversation, without the body.
export type GrokRequest=Omit<GrokEnvelope,'text'>;
export type GrokReceipt={envelope:GrokRequest;sessionId:string;generation:string;hookAt:number;reason:string;promptId:string|null;hookName:string|null;hookPid:number};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_FILE=65_536;
export const inboxRoot=(home=homedir())=>join(home,'.seamless','grok-inbox');
// A request is named by its sender and id together, as the reservation names it: two conversations may pick the same id.
export type InboxSender={id:string;nativeId:string};
export const keyOf=(sender:InboxSender,id:string)=>createHash('sha256').update(JSON.stringify([sender.id,sender.nativeId,id])).digest('hex');
export function conversationDir(home:string,sessionId:string){if(!UUID.test(sessionId))throw new Error('invalid_session');return join(inboxRoot(home),sessionId);}
async function isPrivateDir(path:string){
 try{const s=await lstat(path);return s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid?.()&&(s.mode&0o777)===0o700;}catch{return false;}
}
async function privateDir(path:string){
 await mkdir(path,{recursive:true,mode:0o700});
 if(!await isPrivateDir(path))throw new Error('unsafe_inbox');
}
// Whether every directory on the way to this conversation's inbox, and each state in it, is a real directory of this
// user that no one else can enter. Checked again when the hook reads, since it may have changed after the write.
export async function inboxSafe(home:string,sessionId:string):Promise<boolean>{
 let dir:string;try{dir=conversationDir(home,sessionId);}catch{return false;}
 for(const path of [join(home,'.seamless'),inboxRoot(home),dir,...STATES.map(state=>join(dir,state))])if(!await isPrivateDir(path))return false;
 return true;
}
export async function ensureInbox(home:string,sessionId:string){
 await privateDir(join(home,'.seamless'));await privateDir(inboxRoot(home));
 const dir=conversationDir(home,sessionId);await privateDir(dir);
 for(const state of STATES)await privateDir(join(dir,state));
 return dir;
}
// A regular file owned by this user, mode 0600, not a link, and small; anything else is unreadable.
export async function readPrivate(path:string):Promise<string|null>{
 let f;try{f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const s=await f.stat();if(!s.isFile()||s.uid!==process.getuid?.()||(s.mode&0o777)!==0o600||s.size>MAX_FILE)return null;return await f.readFile('utf8');}catch{return null;}finally{await f?.close();}
}
// Written in full to a private temporary file, then linked into place: the name appears only with complete content.
export async function publishFile(path:string,contents:string):Promise<boolean>{
 const tmp=path+'.'+randomUUID()+'.tmp';let f;
 try{f=await open(tmp,'wx',0o600);await f.writeFile(contents);await f.sync();await f.close();f=undefined;await link(tmp,path);return true;}
 catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')return false;throw e;}
 finally{await f?.close();await unlink(tmp).catch(()=>{});}
}
// Written in full to a private temporary file, then renamed over the target: a reader sees either the old content or the
// complete new content, never a mixture. Used to drop an envelope's body before the file is moved out of handed/.
// The body goes with this write, not with a delete: delivery never unlinks the envelope, so an unlink that fails cannot
// leave the body behind. The temporary file holds the same body-less contents, so a leftover cannot keep the body either.
export async function replaceFile(path:string,contents:string):Promise<void>{
 const tmp=path+'.'+randomUUID()+'.tmp';let f;
 try{f=await open(tmp,'wx',0o600);await f.writeFile(contents);await f.sync();await f.close();f=undefined;await rename(tmp,path);}
 finally{await f?.close();await unlink(tmp).catch(()=>{});}
}
// The state that holds a request, or null. handed/ names carry the hook pid after the key.
export async function stateOf(home:string,sessionId:string,sender:InboxSender,id:string):Promise<{state:InboxState;name:string}|null>{
 const dir=conversationDir(home,sessionId),key=keyOf(sender,id);
 for(const state of STATES){
  let names:string[]=[];try{names=await readdir(join(dir,state));}catch{continue;}
  const name=names.find(n=>n===key+'.json'||n.startsWith(key+'.')&&n.endsWith('.json')&&!n.endsWith('.tmp'));
  if(name)return {state,name};
 }
 return null;
}
export function validEnvelope(v:any):v is GrokEnvelope{
 return validRequest(v)&&typeof (v as GrokEnvelope).text==='string'&&[...(v as GrokEnvelope).text].length<=MAX_GROK_TEXT;
}
// The same request without its body. A receipt is written in this shape, so a delivered envelope's text does not survive it.
export function validRequest(v:any):v is GrokRequest{
 const party=(p:any)=>p&&typeof p==='object'&&['id','nativeId','generation'].every(k=>typeof p[k]==='string'&&p[k].length>0&&p[k].length<=4096);
 return !!v&&typeof v==='object'&&v.schemaVersion===1&&typeof v.id==='string'&&v.id.length>0&&v.id.length<=256
  &&party(v.sender)&&party(v.recipient)&&(v.replyTo===undefined||typeof v.replyTo==='string'&&v.replyTo.length>0)&&(!Object.hasOwn(v,'humanApproval')||v.humanApproval===false)&&Number.isFinite(v.acceptedAt);
}
export function requestOf(e:GrokEnvelope):GrokRequest{
 return {schemaVersion:e.schemaVersion,id:e.id,sender:e.sender,recipient:e.recipient,...(e.replyTo?{replyTo:e.replyTo}:{}),...(Object.hasOwn(e,'humanApproval')?{humanApproval:false}:{}),acceptedAt:e.acceptedAt};
}
// Puts an envelope in pending/. A request already present in any state is never put again.
export async function putEnvelope(home:string,envelope:GrokEnvelope):Promise<{status:'written'}|{status:'exists';state:InboxState}>{
 if(!validEnvelope(envelope))throw new Error('invalid_envelope');
 const dir=await ensureInbox(home,envelope.recipient.nativeId);
 const present=await stateOf(home,envelope.recipient.nativeId,envelope.sender,envelope.id);if(present)return {status:'exists',state:present.state};
 const written=await publishFile(join(dir,'pending',keyOf(envelope.sender,envelope.id)+'.json'),JSON.stringify(envelope));
 if(!written){const now=await stateOf(home,envelope.recipient.nativeId,envelope.sender,envelope.id);return {status:'exists',state:now?.state??'pending'};}
 return {status:'written'};
}
export async function readJson<T>(path:string,valid:(v:any)=>v is T):Promise<T|null>{
 const raw=await readPrivate(path);if(raw===null)return null;
 try{const v=JSON.parse(raw);return valid(v)?v:null;}catch{return null;}
}
// A receipt written by this version holds the request metadata; one written before the body was dropped holds the whole
// envelope. Both are read, and only the metadata is returned, so an older inbox cannot leak a body through this path.
type StoredReceipt={envelope:GrokEnvelope|GrokRequest;sessionId:string;generation:string;hookAt:number;reason:string;promptId:string|null;hookName:string|null;hookPid:number};
function receiptFields(v:any):boolean{
 return !!v&&typeof v==='object'&&typeof v.sessionId==='string'&&typeof v.generation==='string'&&Number.isFinite(v.hookAt)&&typeof v.reason==='string'&&(v.promptId===null||typeof v.promptId==='string')&&(v.hookName===null||typeof v.hookName==='string')&&Number.isSafeInteger(v.hookPid);
}
// A receipt of this version: the request's metadata, and no body. This is the shape a handed file holds between its last
// two steps, so a hook that died there can be finished by the next one without reading an envelope again.
export function validGrokReceipt(v:any):v is GrokReceipt{
 return receiptFields(v)&&validRequest(v.envelope)&&!Object.hasOwn(v.envelope,'text');
}
function validReceipt(v:any):v is StoredReceipt{
 return receiptFields(v)&&(validRequest(v.envelope)||validEnvelope(v.envelope));
}
// Receipts the hook wrote for this conversation, oldest first. Unreadable ones are left out.
export async function receipts(home:string,sessionId:string):Promise<GrokReceipt[]>{
 let dir:string;try{dir=join(conversationDir(home,sessionId),'delivered');}catch{return [];}
 let names:string[]=[];try{names=(await readdir(dir)).filter(n=>/^[0-9a-f]{64}\.json$/.test(n));}catch{return [];}
 const out:GrokReceipt[]=[];
 for(const n of names){
  const r=await readJson(join(dir,n),validReceipt);
  if(!r||r.sessionId!==sessionId)continue;
  const envelope:any=r.envelope;
  out.push({...r,envelope:typeof envelope.text==='string'?requestOf(envelope as GrokEnvelope):envelope as GrokRequest});
 }
 return out.sort((a,b)=>a.hookAt-b.hookAt);
}
