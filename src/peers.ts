import {realpath} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {readPrivateJson} from './limits.ts';

// The roster of executors outside this Mac (Grok Bot). Only the owner writes ~/.seamless/peers.json: the program has no writer here;
// the one writer is the owner's own setup script (scripts/peer-setup.sh, through scripts/peer-roster-write.ts).
// It holds the NAMES of environment variables, never their values, and this module never reads process.env.
export type PeerScope=string[]|'all';
export type Peer={name:string;displayName:string;product:'grok-bot';addressEnv:string;sendKeyEnv:string;receiveKeyEnv:string;keyVersion:number;revoked?:{at:string};operations?:{read?:false;send?:boolean};scope?:PeerScope;botIds?:string[]};
export type Peers={version:1;peers:Peer[]};
export type PeersRead=
 | {status:'absent';hash:null}
 | {status:'ok';value:Peers;hash:string}
 | {status:'unusable'};
export type PeerStatus='registered'|'revoked'|'scope_unset';
export type PeerUse={usable:true}|{usable:false;reason:Exclude<PeerStatus,'registered'>};
export type ExternalPeer={id:string;product:'grok-bot';host:'external';displayName:string;keyVersion:number;operations:{read:false;send:boolean};status:PeerStatus;ticket:string|null};
export type ExternalList={external:ExternalPeer[];externalStatus?:'unusable'};

const NAME=/^[a-z0-9-]{1,63}$/,ENV=/^[A-Z_][A-Z0-9_]{0,127}$/,ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const KEYS=['name','displayName','product','addressEnv','sendKeyEnv','receiveKeyEnv','keyVersion','revoked','operations','scope','botIds'];
// The Bot's own UUIDs as its app hands them to a command (src/bot-executor.ts): lower-case, one or more, no repeats.
const BOT_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function defaultPeersPath(home=homedir()):string{return join(home,'.seamless','peers.json');}
function record(value:unknown,keys:string[]):Record<string,unknown>|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 return Object.keys(value).every(k=>keys.includes(k))?value as Record<string,unknown>:null;
}
// A scope root is a normalized absolute path. "/" is refused: reaching every workspace takes the explicit "all".
function validRoot(value:unknown):boolean{return typeof value==='string'&&value.length<=4096&&value!=='/'&&value.startsWith('/')&&!value.includes('\0')&&resolve(value)===value;}
function validPeer(value:unknown):value is Peer{
 const v=record(value,KEYS);
 if(!v||['name','displayName','product','addressEnv','sendKeyEnv','receiveKeyEnv','keyVersion'].some(k=>!Object.hasOwn(v,k)))return false;
 if(typeof v.name!=='string'||!NAME.test(v.name)||typeof v.displayName!=='string'||[...v.displayName].length<1||[...v.displayName].length>64||v.product!=='grok-bot')return false;
 // The address and the two keys must be three different names, so a send key can never stand in for a receive key.
 const envs=[v.addressEnv,v.sendKeyEnv,v.receiveKeyEnv];
 if(!envs.every(e=>typeof e==='string'&&ENV.test(e))||new Set(envs).size!==3||!Number.isSafeInteger(v.keyVersion)||(v.keyVersion as number)<1)return false;
 if(Object.hasOwn(v,'revoked')){const r=record(v.revoked,['at']);if(!r||typeof r.at!=='string'||!ISO.test(r.at)||Number.isNaN(Date.parse(r.at)))return false;}
 if(Object.hasOwn(v,'operations')){const o=record(v.operations,['read','send']);if(!o||Object.hasOwn(o,'read')&&o.read!==false||Object.hasOwn(o,'send')&&typeof o.send!=='boolean')return false;}
 if(Object.hasOwn(v,'botIds')&&!(Array.isArray(v.botIds)&&v.botIds.length>0&&v.botIds.every(id=>typeof id==='string'&&BOT_ID.test(id))&&new Set(v.botIds).size===v.botIds.length))return false;
 return !Object.hasOwn(v,'scope')||v.scope==='all'||Array.isArray(v.scope)&&v.scope.length>0&&v.scope.every(validRoot);
}
export function validPeers(value:unknown):value is Peers{
 const v=record(value,['version','peers']);
 if(!v||v.version!==1||!Array.isArray(v.peers)||!v.peers.every(validPeer))return false;
 const peers=v.peers as Peer[];
 if(new Set(peers.map(p=>p.name)).size!==peers.length)return false;
 // Across the whole roster every address and key name is used once: a key shared by two registrations could not tell which
 // sender signed (AC5), and one registration's send key must never be another's receive key.
 const envs=peers.flatMap(p=>[p.addressEnv,p.sendKeyEnv,p.receiveKeyEnv]);
 return new Set(envs).size===envs.length;
}
// Read afresh on every call, through the same private-file check as limits.json (lstat, O_NOFOLLOW, same inode, mode 0600, owner).
export function readPeers(path=defaultPeersPath()):Promise<PeersRead>{return readPrivateJson(path,validPeers);}
// The key a key variable stands for: the app's field shows "Bearer <key>", and a value copied whole is that key with the one prefix
// taken off (specs/202610-more-peers Plans.md, 送る). Sending uses it, and so does every comparison of two key values.
export const keyOf=(value:string):string=>value.startsWith('Bearer ')?value.slice('Bearer '.length):value;
export const peerId=(p:Pick<Peer,'product'|'name'>):string=>`${p.product}:${p.name}`;
export function peerStatus(p:Peer):PeerStatus{return p.revoked?'revoked':p.scope===undefined?'scope_unset':'registered';}
export function peerUse(p:Peer):PeerUse{const s=peerStatus(p);return s==='registered'?{usable:true}:{usable:false,reason:s};}
// read is never offered; send only when the owner wrote true and the registration is usable.
export function peerOperations(p:Peer):{read:false;send:boolean}{return {read:false,send:peerStatus(p)==='registered'&&p.operations?.send===true};}
// A workspace is in scope when it is a listed folder or inside one; both sides are resolved so a symlinked spelling matches.
// A workspace that cannot be resolved (it does not exist, or the path has ".." in it) is outside every listed folder.
export async function scopeAllows(p:Peer,cwd:string):Promise<boolean>{
 if(p.scope==='all')return true;
 if(!p.scope)return false;
 const here=await realpath(cwd).catch(()=>null);
 if(here===null)return false;
 for(const root of p.scope){const real=await realpath(root).catch(()=>root);if(here===real||here.startsWith(real+'/'))return true;}
 return false;
}
// What sessions shows for registered outside executors. A registration whose scope is unset is never listed (AC8); a revoked
// one in scope is listed as revoked with send false. send is the registration's value AND the owner's limits operations.send
// (sendAllowed; an absent limits file imposes nothing, but never turns a registration's false into true).
// ticket is what send takes to reach the registration, like a conversation's: present only when send is true and issue (which knows
// the owner's limits) agrees for this caller's folder. It names the registration and its key version, never an address or a key.
// Nothing but names, numbers and that ticket leaves here: no address, no key.
export async function externalPeers(read:PeersRead,cwd:string,target?:string,sendAllowed=true,issue?:(p:Peer)=>Promise<string|null>):Promise<ExternalList>{
 if(read.status==='absent')return {external:[]};
 if(read.status==='unusable')return {external:[],externalStatus:'unusable'};
 const external:ExternalPeer[]=[];
 for(const p of read.value.peers){
  if(target!==undefined&&target!==peerId(p)||!await scopeAllows(p,cwd))continue;
  const send=peerOperations(p).send&&sendAllowed;
  external.push({id:peerId(p),product:p.product,host:'external',displayName:p.displayName,keyVersion:p.keyVersion,operations:{read:false,send},status:peerStatus(p),ticket:send&&issue?await issue(p):null});
 }
 return {external};
}
// Where the roster refers to an environment variable: the registration, the role and the name. For the leak check in
// scripts/verify.sh, which reports the registration and role, so a secret pasted into a name field is never echoed. Names only.
export type PeerEnvRole='addressEnv'|'sendKeyEnv'|'receiveKeyEnv';
export function peerEnvSlots(peers:Peers):Array<{peer:string;role:PeerEnvRole;env:string}>{
 return peers.peers.flatMap(p=>(['addressEnv','sendKeyEnv','receiveKeyEnv'] as const).map(role=>({peer:p.name,role,env:p[role]})));
}
