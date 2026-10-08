import {constants} from 'node:fs';
import {mkdir,open,link,unlink,readdir,lstat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
// The inbox for one Grok CLI conversation (specs/202610-more-peers Plans.md, "配送"). seamless puts an envelope in pending/;
// the Stop hook of that conversation's own TUI moves one envelope per Stop through delivering/ and handed/ to delivered/.
// Every move is a rename inside one directory tree, so an envelope is in exactly one state at a time.
//   pending    accepted by seamless, not yet taken by a hook
//   delivering taken by a hook (file name carries the hook's pid); back to pending if that hook died before handing it over
//   handed     the hook is returning it to Grok; if the hook dies here the outcome is unknown, and it is never put back
//   delivered  the hook wrote its receipt (request id, conversation, generation, hook time, Stop reason, hook name)
//   failed     the envelope could not be read; the next one is delivered instead
//   unknown    a handed envelope whose hook died; shown as "成否不明" and never delivered again
export const STATES=['pending','delivering','handed','delivered','failed','unknown'] as const;
export type InboxState=typeof STATES[number];
export const MAX_GROK_TEXT=8000;
export type GrokEnvelope={schemaVersion:1;id:string;sender:{id:string;nativeId:string;generation:string};recipient:{id:string;nativeId:string;generation:string};text:string;replyTo?:string;humanApproval?:false;acceptedAt:number};
export type GrokReceipt={envelope:GrokEnvelope;sessionId:string;generation:string;hookAt:number;reason:string;promptId:string|null;hookName:string|null;hookPid:number};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_FILE=65_536;
export const inboxRoot=(home=homedir())=>join(home,'.seamless','grok-inbox');
export const keyOf=(id:string)=>createHash('sha256').update(id).digest('hex');
export function conversationDir(home:string,sessionId:string){if(!UUID.test(sessionId))throw new Error('invalid_session');return join(inboxRoot(home),sessionId);}
async function privateDir(path:string){
 await mkdir(path,{recursive:true,mode:0o700});
 const s=await lstat(path);
 if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid?.()||(s.mode&0o777)!==0o700)throw new Error('unsafe_inbox');
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
// The state that holds a request, or null. delivering/ and handed/ names carry the hook pid after the key.
export async function stateOf(home:string,sessionId:string,id:string):Promise<{state:InboxState;name:string}|null>{
 const dir=conversationDir(home,sessionId),key=keyOf(id);
 for(const state of STATES){
  let names:string[]=[];try{names=await readdir(join(dir,state));}catch{continue;}
  const name=names.find(n=>n===key+'.json'||n.startsWith(key+'.')&&n.endsWith('.json')&&!n.endsWith('.tmp'));
  if(name)return {state,name};
 }
 return null;
}
export function validEnvelope(v:any):v is GrokEnvelope{
 const party=(p:any)=>p&&typeof p==='object'&&['id','nativeId','generation'].every(k=>typeof p[k]==='string'&&p[k].length>0&&p[k].length<=4096);
 return !!v&&typeof v==='object'&&v.schemaVersion===1&&typeof v.id==='string'&&v.id.length>0&&v.id.length<=256&&typeof v.text==='string'&&[...v.text].length<=MAX_GROK_TEXT
  &&party(v.sender)&&party(v.recipient)&&(v.replyTo===undefined||typeof v.replyTo==='string'&&v.replyTo.length>0)&&(!Object.hasOwn(v,'humanApproval')||v.humanApproval===false)&&Number.isFinite(v.acceptedAt);
}
// Puts an envelope in pending/. A request already present in any state is never put again.
export async function putEnvelope(home:string,envelope:GrokEnvelope):Promise<{status:'written'}|{status:'exists';state:InboxState}>{
 if(!validEnvelope(envelope))throw new Error('invalid_envelope');
 const dir=await ensureInbox(home,envelope.recipient.nativeId);
 const present=await stateOf(home,envelope.recipient.nativeId,envelope.id);if(present)return {status:'exists',state:present.state};
 const written=await publishFile(join(dir,'pending',keyOf(envelope.id)+'.json'),JSON.stringify(envelope));
 if(!written){const now=await stateOf(home,envelope.recipient.nativeId,envelope.id);return {status:'exists',state:now?.state??'pending'};}
 return {status:'written'};
}
export async function readJson<T>(path:string,valid:(v:any)=>v is T):Promise<T|null>{
 const raw=await readPrivate(path);if(raw===null)return null;
 try{const v=JSON.parse(raw);return valid(v)?v:null;}catch{return null;}
}
function validReceipt(v:any):v is GrokReceipt{
 return !!v&&typeof v==='object'&&validEnvelope(v.envelope)&&typeof v.sessionId==='string'&&typeof v.generation==='string'&&Number.isFinite(v.hookAt)&&typeof v.reason==='string'&&(v.promptId===null||typeof v.promptId==='string')&&(v.hookName===null||typeof v.hookName==='string')&&Number.isSafeInteger(v.hookPid);
}
// Receipts the hook wrote for this conversation, oldest first. Unreadable ones are left out.
export async function receipts(home:string,sessionId:string):Promise<GrokReceipt[]>{
 let dir:string;try{dir=join(conversationDir(home,sessionId),'delivered');}catch{return [];}
 let names:string[]=[];try{names=(await readdir(dir)).filter(n=>/^[0-9a-f]{64}\.json$/.test(n));}catch{return [];}
 const out:GrokReceipt[]=[];
 for(const n of names){const r=await readJson(join(dir,n),validReceipt);if(r&&r.sessionId===sessionId)out.push(r);}
 return out.sort((a,b)=>a.hookAt-b.hookAt);
}
// Envelopes still waiting (pending, or taken but not handed over yet), and those whose outcome is unknown.
export async function waiting(home:string,sessionId:string):Promise<{state:InboxState;envelope:GrokEnvelope|null;name:string}[]>{
 let dir:string;try{dir=conversationDir(home,sessionId);}catch{return [];}
 const out=[];
 for(const state of ['pending','delivering','handed','unknown'] as const){
  let names:string[]=[];try{names=(await readdir(join(dir,state))).filter(n=>n.endsWith('.json')&&!n.endsWith('.tmp'));}catch{continue;}
  for(const name of names)out.push({state,name,envelope:await readJson(join(dir,state,name),validEnvelope)});
 }
 return out;
}
