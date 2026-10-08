import {PEER_NAMESPACES} from './adapters/codex.ts';
import {lstat,readFile,readdir,realpath} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createConnection,type Socket} from 'node:net';
import {randomUUID,createHash} from 'node:crypto';
import {isClaudeVersionAllowed,isVersionAllowed,productOf,type CompatibilityOptions} from './compat.ts';
import {observeGit} from './git-context.ts';
import type {Registration,Observation} from './protocol.ts';
import type {Observer} from './registry.ts';
import type {NativeAdapter,Envelope,Receipt} from './delivery.ts';
const exec=promisify(execFile);
const nativePeerNamespaces=PEER_NAMESPACES.filter(name=>!name.endsWith('_test'));
export type NativeIdentity={version?:string|null;nativeId:string;generation:string;cwd:string;socket:string;owner?:string;pid?:number};
export type RuntimeOptions=CompatibilityOptions&{home?:string;codexOwner?:(nativeId:string)=>Promise<string|null>;markUnapproved?:()=>Promise<boolean>;desktopVersion?:()=>Promise<string|null>;claudeVersion?:(nativeId:string)=>Promise<string>;claudeIdentity?:(nativeId:string)=>Promise<NativeIdentity|null>;codexIdentity?:(nativeId:string)=>Promise<NativeIdentity|null>;grokIdentity?:(nativeId:string,generation?:string)=>Promise<NativeIdentity|null>;grokVersion?:()=>Promise<string|null>;processStart?:(pid:number)=>Promise<number|null>;read? :NativeAdapter['read']};
export async function command(file:string,args:string[]){return (await exec(file,args,{encoding:'utf8',timeout:5000,maxBuffer:1048576,env:{...process.env,TZ:'UTC',LC_ALL:'C',PATH:'/bin:/usr/sbin:/usr/bin'}})).stdout;}
export async function ownedSocket(path:string,strict=true){const [s,p]=await Promise.all([lstat(path),lstat(dirname(path))]);const uid=process.getuid?.();return s.isSocket()&&s.uid===uid&&(!strict||(s.mode&0o777)===0o600)&&p.isDirectory()&&p.uid===uid&&(p.mode&0o022)===0;}
export type ClaudeInspection=CompatibilityOptions&{command?:typeof command;socket?:typeof ownedSocket};
// The session record Claude Code writes for its own process, checked for shape only.
export async function claudeSessionRecord(pid:number,home=homedir()):Promise<any|null>{
 try{
  if(!Number.isSafeInteger(pid)||pid<=0)return null;
  const path=join(home,'.claude','sessions',`${pid}.json`),s=await lstat(path);
  if(!s.isFile()||s.uid!==process.getuid?.()||(s.mode&0o022)!==0||s.size>65536)return null;
  const m=JSON.parse(await readFile(path,'utf8'));
  if(m.pid!==pid||typeof m.sessionId!=='string'||!m.sessionId||m.version!=null&&typeof m.version!=='string'||m.peerProtocol!==1||typeof m.procStart!=='string'||typeof m.startedAt!=='number'&&typeof m.startedAt!=='string'||typeof m.cwd!=='string'||typeof m.messagingSocketPath!=='string')return null;
  return m;
 }catch{return null;}
}
// The process named by a record is running under this user and started when the record says.
export async function claudeProcessMatches(pid:number,procStart:string,run:typeof command=command):Promise<boolean>{
 try{const [uid,...start]=(await run('ps',['-p',String(pid),'-o','uid=,lstart='])).trim().split(/\s+/);return Number(uid)===process.getuid?.()&&start.join(' ')===procStart.replace(/\s+/g,' ').trim();}catch{return false;}
}
// One lsof listing of a process: its working directory, its executable (first txt entry) and its unix sockets.
export type ProcessFiles={cwd:string|null;executable:string|null;sockets:string[]};
export async function processFiles(pid:number,run:typeof command=command):Promise<ProcessFiles>{
 const files:ProcessFiles={cwd:null,executable:null,sockets:[]};let fd='',type='';
 for(const line of (await run('lsof',['-p',String(pid),'-Fnft'])).split('\n')){
  const value=line.slice(1);
  if(line.startsWith('f')){fd=value;type='';}else if(line.startsWith('t'))type=value;
  else if(line.startsWith('n')){if(fd==='cwd')files.cwd??=value;else if(fd==='txt')files.executable??=value;else if(type==='unix')files.sockets.push(value);}
 }
 return files;
}
export async function findClaudeIdentityByPid(pid:number,home=homedir(),options:ClaudeInspection={},allowUnsupportedVersion=false,files?:ProcessFiles):Promise<NativeIdentity|null>{
 try{
  const m=await claudeSessionRecord(pid,home);
  if(!m||!allowUnsupportedVersion&&!isClaudeVersionAllowed(m.version,options))return null;
  const run=options.command??command;
  if(!await claudeProcessMatches(pid,m.procStart,run))return null;
  const {cwd,sockets}=files??await processFiles(pid,run);
  if(!cwd||await realpath(cwd)!==await realpath(m.cwd)||!await (options.socket??ownedSocket)(m.messagingSocketPath))return null;
  if(!sockets.includes(m.messagingSocketPath))return null;
  return {version:m.version,nativeId:m.sessionId,generation:`${pid}@${m.startedAt}`,cwd:await realpath(cwd),socket:m.messagingSocketPath,pid};
 }catch{return null;}
}
export async function findClaudeIdentity(nativeId:string,home=homedir(),options:ClaudeInspection={}):Promise<NativeIdentity|null>{
 try{
  const dir=join(home,'.claude','sessions');
  const candidates=await Promise.all((await readdir(dir)).filter(name=>/^\d+\.json$/.test(name)).map(async name=>{
   try{const path=join(dir,name),s=await lstat(path);if(!s.isFile()||s.size>65536)return null;return JSON.parse(await readFile(path,'utf8'))?.sessionId===nativeId?Number(name.slice(0,-5)):null;}catch{return null;}
  }));
  for(const pid of candidates){if(pid===null)continue;const n=await findClaudeIdentityByPid(pid,home,options);if(n?.nativeId===nativeId)return n;}
 }catch{}return null;
}
export function sendClaudeFrame(socket:Socket,revalidate:()=>Promise<boolean>,frame:string,messageId:string):Promise<Receipt>{
 return new Promise(resolve=>{
  let attempted=false,flushed=false,settled=false;
  const finish=(status:Receipt['status'])=>{if(settled)return;settled=true;socket.destroy();resolve(status==='submitted'?{status,nativeMessageId:messageId}:{status});};
  socket.setTimeout(5000);
  socket.on('error',()=>finish(attempted?'unknown':'rejected'));
  // Claude Code takes a line once the sender half-closes; it then closes its side.
  socket.on('close',()=>finish(flushed?'submitted':attempted?'unknown':'rejected'));
  socket.on('timeout',()=>finish(attempted?'unknown':'rejected'));
  socket.on('connect',async()=>{
   try{if(!await revalidate()||settled||socket.destroyed){finish('rejected');return;}
    attempted=true;
    socket.write(frame,error=>{if(error){finish('unknown');return;}if(socket.destroyed){finish('unknown');return;}flushed=true;socket.end();});
   }catch{finish(attempted?'unknown':'rejected');}
  });
 });
}
class IPC{
 responses=new Map<string,{resolve:(x:any)=>void;reject:(e:Error)=>void}>();
 socket:ReturnType<typeof createConnection>;buffer=Buffer.alloc(0);queue:any[]=[];waiters:Array<{resolve:(x:any)=>void;reject:(e:Error)=>void}>=[];
 constructor(path:string){this.socket=createConnection(path);this.socket.on('data',part=>{this.buffer=Buffer.concat([this.buffer,part]);while(this.buffer.length>=4){const size=this.buffer.readUInt32LE();if(size<1||size>268435456){this.socket.destroy(new Error('invalid_frame'));return;}if(this.buffer.length<size+4)return;let frame;try{frame=JSON.parse(this.buffer.subarray(4,size+4).toString());}catch{this.socket.destroy(new Error('invalid_frame'));return;}this.buffer=this.buffer.subarray(size+4);const response=frame.type==='response'?this.responses.get(frame.requestId):undefined;if(response){response.resolve(frame);continue;}const w=this.waiters.shift();if(w)w.resolve(frame);else this.queue.push(frame);}});this.socket.on('error',e=>{for(const w of this.waiters.splice(0))w.reject(e);for(const w of this.responses.values())w.reject(e);});this.socket.on('close',()=>{for(const w of this.responses.values())w.reject(new Error('ipc_closed'));});}
 write(frame:unknown){const b=Buffer.from(JSON.stringify(frame)),prefix=Buffer.alloc(4);prefix.writeUInt32LE(b.length);this.socket.write(Buffer.concat([prefix,b]));}
 async next(timeoutMs=8000){if(this.queue.length)return this.queue.shift();return new Promise<any>((resolve,reject)=>{const w={resolve:(x:any)=>{clearTimeout(t);resolve(x);},reject:(e:Error)=>{clearTimeout(t);reject(e);}};const t=setTimeout(()=>{this.waiters=this.waiters.filter(x=>x!==w);reject(new Error('timeout'));},timeoutMs);this.waiters.push(w);});}
 async request(method:string,params:unknown,client:string,version:number,owner?:string,timeoutMs=8000){
  const requestId=randomUUID();
  return new Promise<any>((resolve,reject)=>{
   const finish=(error:Error|null,frame?:any)=>{clearTimeout(timer);this.responses.delete(requestId);if(error)reject(error);else resolve(frame);};
   const timer=setTimeout(()=>finish(new Error('timeout')),timeoutMs);
   this.responses.set(requestId,{resolve:frame=>finish(null,frame),reject:error=>finish(error)});
   try{this.write({type:'request',requestId,sourceClientId:client,version,method,params,timeoutMs:5000,...(owner?{targetClientId:owner}:{})});}catch(error){finish(error as Error);}
  });
 }
 close(){this.socket.end();const timer=setTimeout(()=>this.socket.destroy(),1000);timer.unref();}
}
async function codexConnection(nativeId:string,home:string,ownerTimeoutMs=8000,versionOf?:()=>Promise<string|null>,options:CompatibilityOptions={}){const path=join(home,'.codex','ipc','ipc.sock');const {desktopVersion}=await import('./adapters/codex.ts');const version=await (versionOf??desktopVersion)();if(!isVersionAllowed('codex',version,options))throw new Error('unsupported_version');if(!await ownedSocket(path,false))throw new Error('unsafe_socket');const ipc=new IPC(path);try{const initial=await ipc.request('initialize',{clientType:'seamless-native-runtime'},'initializing-client',0);if(initial.resultType!=='success')throw new Error('initialize');const client=initial.result.clientId;const found=await ipc.request('thread-owner-discovery',{hostId:'local',conversationId:nativeId},client,1,undefined,ownerTimeoutMs);if(found.resultType!=='success'||typeof found.handledByClientId!=='string')throw new Error('owner');return {ipc,client,owner:found.handledByClientId,sendSupported:found.result?.supportsUntrustedAppInput===true,path};}catch(e){ipc.close();throw e;}}
// A band owns this lookup and closes it in finally. Discovery remains per conversation.
export const OWNER_LIMIT_MS=500;
export function createCodexOwnerLookup(home=homedir(),versionOf?:()=>Promise<string|null>,options:CompatibilityOptions={}){
 let connection:Promise<{ipc:IPC;client:string}>|undefined;
 const owners=new Map<string,Promise<string|null>>();
 const connect=async()=>{
  const version=await (versionOf??(await import('./adapters/codex.ts')).desktopVersion)();
  if(!isVersionAllowed('codex',version,options))throw new Error('unsupported_version');
  const path=join(home,'.codex','ipc','ipc.sock');if(!await ownedSocket(path,false))throw new Error('unsafe_socket');
  const ipc=new IPC(path);
  try{const initial=await ipc.request('initialize',{clientType:'seamless-native-runtime'},'initializing-client',0);
   if(initial.resultType!=='success'||typeof initial.result?.clientId!=='string')throw new Error('initialize');
   return {ipc,client:initial.result.clientId as string};
  }catch(e){ipc.close();throw e;}
 };
 return {
  owner(id:string){
   let result=owners.get(id);if(result)return result;
   result=(async()=>{try{
    const {ipc,client}=await (connection??=connect());
    // Same limit as the sessions scan. Desktop answers a loaded thread within tens of milliseconds (measured 2026-10-07:
    // median 3ms, max 36ms, 11ms inside a wave of 64) and an unloaded one only after its own 10s wait, so the limit is
    // paid in full by every unloaded thread and sets the floor of a sessions call.
    const found=await ipc.request('thread-owner-discovery',{hostId:'local',conversationId:id},client,1,undefined,OWNER_LIMIT_MS);
    return found.resultType==='success'&&typeof found.handledByClientId==='string'?found.handledByClientId:null;
   }catch{return null;}})();
   owners.set(id,result);return result;
  },
  async close(){await Promise.all(owners.values());try{(await connection)?.ipc.close();}catch{}}
 };
}
// Owner discovery never subscribes to a conversation snapshot.
// Desktop answers initialize only while it runs; a link opened without it would launch the app.
export async function codexReachable(home=homedir(),versionOf?:()=>Promise<string|null>,options:CompatibilityOptions={}):Promise<boolean>{
 try{const version=await (versionOf??(await import('./adapters/codex.ts')).desktopVersion)();if(!isVersionAllowed('codex',version,options))return false;
  const path=join(home,'.codex','ipc','ipc.sock');if(!await ownedSocket(path,false))return false;
  const ipc=new IPC(path);try{const initial=await ipc.request('initialize',{clientType:'seamless-native-runtime'},'initializing-client',0,undefined,1500);return initial.resultType==='success';}finally{ipc.close();}
 }catch{return false;}
}
export async function findCodexOwner(nativeId:string,home=homedir(),timeoutMs=8000,versionOf?:()=>Promise<string|null>,options:CompatibilityOptions={}):Promise<string|null>{
 let c:Awaited<ReturnType<typeof codexConnection>>|undefined;
 try{c=await codexConnection(nativeId,home,timeoutMs,versionOf,options);return c.owner;}catch{return null;}finally{c?.ipc.close();}
}
export async function findCodexIdentity(nativeId:string,home=homedir()):Promise<NativeIdentity|null>{let c:Awaited<ReturnType<typeof codexConnection>>|undefined;try{c=await codexConnection(nativeId,home);c.ipc.write({type:'broadcast',sourceClientId:c.client,targetClientIds:[c.owner],version:1,method:'thread-stream-following-changed',params:{hostId:'local',conversationId:nativeId,following:true}});const deadline=Date.now()+8000;for(;;){if(Date.now()>deadline)throw new Error('timeout');const f=await c.ipc.next(),p=f.params,change=p?.change;if(f.type!=='broadcast'||f.method!=='thread-stream-state-changed'||f.version!==11||f.sourceClientId!==c.owner||!f.targetClientIds?.includes(c.client)||p?.hostId!=='local'||p?.conversationId!==nativeId||change?.type!=='snapshot')continue;const state=change.conversationState;if(state?.id!==nativeId||typeof state.cwd!=='string')return null;return {nativeId,generation:c.owner,cwd:await realpath(state.cwd),socket:c.path,owner:c.owner};}}catch{return null;}finally{if(c){c.ipc.write({type:'broadcast',sourceClientId:c.client,targetClientIds:[c.owner],version:1,method:'thread-stream-following-changed',params:{hostId:'local',conversationId:nativeId,following:false}});c.ipc.close();}}}
export async function claudeVersion(nativeId:string,home=homedir()):Promise<string>{
 const {findClaudeSession}=await import('./adapters/claude.ts');
 const n=await findClaudeSession(nativeId,{home});return n&&n!=='unreadable'?n.version:'unknown';
}
export function createNativeRuntime(options:RuntimeOptions={}):{observer:Observer;adapter:NativeAdapter;checkCompatibility:(r:Pick<Registration,'provider'|'nativeId'>,compatibility?:CompatibilityOptions)=>Promise<{status:'unsupported_version';reason:string;version:string}|null>}{
 const home=options.home??homedir();const grok=async()=>import('./adapters/grok.ts');
 const inspect=async(r:Registration)=>r.provider==='claude'?(options.claudeIdentity??((id:string)=>findClaudeIdentity(id,home,options)))(r.nativeId):r.provider==='grok'?(options.grokIdentity??(async(id:string,generation?:string)=>(await grok()).grokIdentity(id,{...options,home},generation)))(r.nativeId,r.generation):(options.codexIdentity??((id:string)=>findCodexIdentity(id,home)))(r.nativeId);
 const checkCompatibility=async(r:Pick<Registration,'provider'|'nativeId'>,compatibility:CompatibilityOptions={})=>{
  const version=r.provider==='codex'?await (options.desktopVersion??(await import('./adapters/codex.ts')).desktopVersion)():r.provider==='grok'?await (options.grokVersion??(async()=>(await grok()).grokVersion(home)))():await (options.claudeVersion??((id:string)=>claudeVersion(id,home)))(r.nativeId);
  return isVersionAllowed(productOf(r.provider),version,{...options,...compatibility})?null:{status:'unsupported_version' as const,reason:version??'unknown',version:version??'unknown'};
 };
 const observer:Observer=async r=>{const n=await inspect(r);if(!n)return null;const context=await observeGit(n.cwd);const now=Date.now();return {nativeId:n.nativeId,generation:n.generation,status:'online',observedAt:now,contextObservedAt:now,source:`native:${r.provider}`,gitSource:'observeGit',cwd:n.cwd,context} satisfies Observation;};
 const adapter:NativeAdapter={read:async(target,o)=>{if(options.read)return options.read(target,o);const unsupported=await checkCompatibility(target);if(unsupported)return unsupported;const [{createReader},{createClaudeReader},{createCodexReader},{createGrokReader}]=await Promise.all([import('./adapters/read.ts'),import('./adapters/claude.ts'),import('./adapters/codex.ts'),grok()]);return createReader({claude:createClaudeReader({...options,home}),codex:createCodexReader({...options,version:options.desktopVersion,owner:options.codexOwner,socketPath:join(home,'.codex','ipc','ipc.sock')}),grok:createGrokReader({...options,home,grokVersion:options.grokVersion})})(target,o);},send:async(target,envelope,authorize):Promise<Receipt>=>{
  // Delivery to Grok CLI goes through its inbox and Stop hook (specs/202610-more-peers T1-4, T1-5), not built yet.
  if(target.provider==='grok')return {status:'rejected',reason:'grok_delivery_unavailable'};
  const unsupported=await checkCompatibility(target);if(unsupported)return {status:'rejected',reason:unsupported.status,version:unsupported.version};const n=await inspect(target);if(!n||n.generation!==target.generation||envelope.recipient.nativeId!==target.nativeId||envelope.recipient.generation!==target.generation)return {status:'rejected'};const payload={schemaVersion:1,...envelope,...(await options.markUnapproved?.()===true?{humanApproval:false}:{})};if(target.provider==='claude'){const content=JSON.stringify(payload),payloadSha256=createHash('sha256').update(content).digest('hex');const receipt=await sendClaudeFrame(createConnection(n.socket),async()=>{const current=await inspect(target);return !!current&&current.generation===n.generation&&current.socket===n.socket&&(!authorize||await authorize());},JSON.stringify({type:'user',session_id:n.nativeId,from:'seamless',uuid:envelope.id,msg_id:envelope.id,message:{content}})+'\n',envelope.id);return {...receipt,payloadSha256};}let c:Awaited<ReturnType<typeof codexConnection>>|undefined,attempted=false;try{c=await codexConnection(n.nativeId,home,8000,options.desktopVersion,options);if(c.owner!==n.generation||authorize&&!await authorize())return {status:'rejected'};attempted=true;const response=await c.ipc.request('thread-follower-start-turn',{conversationId:n.nativeId,turnStart:{request:{threadId:n.nativeId,input:[],toolOutput:{namespace:'seamless',name:'external_message',output:JSON.stringify(payload)}},context:{inheritThreadSettings:true}}},c.client,2,c.owner);if(response.handledByClientId!==c.owner)return {status:'unknown'};return {status:response.resultType==='success'?'submitted':'unknown',nativeMessageId:envelope.id};}catch{return {status:attempted?'unknown':'rejected'};}finally{c?.ipc.close();}}};adapter.structure=async target=>{const unsupported=await checkCompatibility(target);if(unsupported||target.provider==='grok')return [];if(target.provider==='claude')return (await import('./adapters/claude.ts')).readClaudeStructure(target,{...options,home});return (await import('./adapters/codex.ts')).readCodexStructure(target,{...options,version:options.desktopVersion,owner:options.codexOwner,socketPath:join(home,'.codex','ipc','ipc.sock')});};adapter.inbound=async recipient=>{const result=await adapter.read(recipient,{limit:100}) as {status:string;items?:Array<{role:string;text:string;peer?:{namespace:string;declaredSender?:string;messageId?:string;envelope?:Envelope}}>};if(result.status!=='ok')return [];const found:Envelope[]=[];for(const item of result.items??[]){if(item.role!=='peer'||!item.peer||!(item.peer.namespace==='claude-peer'||nativePeerNamespaces.includes(item.peer.namespace)))continue;let e:any=item.peer.envelope;if(!e){try{e=JSON.parse(item.text);}catch{continue;}}if(!e||!item.peer.envelope&&(e.schemaVersion!==1||(Object.hasOwn(e,'humanApproval')&&e.humanApproval!==false))||typeof e.id!=='string'||e.id!==item.peer.messageId||item.peer.namespace==='claude-peer'&&!nativePeerNamespaces.includes(item.peer.declaredSender??'')||typeof e.text!=='string'||!['sender','recipient'].every(key=>e[key]&&['id','nativeId','generation'].every(field=>typeof e[key][field]==='string'&&e[key][field]))||e.replyTo!==undefined&&typeof e.replyTo!=='string')continue;found.push(e);}return found;};adapter.sentIds=async(target,ids,recipient)=>{
 if(target.provider==='grok'||await checkCompatibility(target))return [];
 return target.provider==='claude'?(await import('./adapters/claude.ts')).readClaudeSentIds(target,ids,recipient,{...options,home}):(await import('./adapters/codex.ts')).readCodexSentIds(target,ids,recipient,{...options,version:options.desktopVersion,owner:options.codexOwner,socketPath:join(home,'.codex','ipc','ipc.sock')});
 };adapter.received=async target=>{
 if(target.provider==='grok'||await checkCompatibility(target))return [];
 const reader=target.provider==='claude'?(await import('./adapters/claude.ts')).createClaudeReader({...options,home}):(await import('./adapters/codex.ts')).createCodexReader({...options,version:options.desktopVersion,owner:options.codexOwner,socketPath:join(home,'.codex','ipc','ipc.sock')});
 const transcript=await reader(target,{complete:true});
 return 'items' in transcript&&transcript.generation===target.generation?(await import('./inbound.ts')).receivedMetadata(transcript.items):[];
 };return {observer,adapter,checkCompatibility};
}
// Call only for sessions whose read/send operations were explicitly authorized.
export async function observeSessionPair(pair:readonly [{provider:Registration['provider'];nativeId:string},{provider:Registration['provider'];nativeId:string}],workspace:string,inspect?:(provider:Registration['provider'],nativeId:string)=>Promise<NativeIdentity|null>):Promise<Registration[]>{
 const read=inspect??((provider,id)=>provider==='codex'?findCodexIdentity(id):findClaudeIdentity(id));
 const identities=await Promise.all(pair.map(p=>read(p.provider,p.nativeId)));
 const cwd=await realpath(workspace);if(identities.some(n=>!n||n.cwd!==cwd))throw new Error('pair_unobserved');
 if(pair[0].provider===pair[1].provider&&pair[0].nativeId===pair[1].nativeId)throw new Error('pair_unobserved');
 const ids=pair.map((p,i)=>pair[0].provider===pair[1].provider?`${p.provider}-${i}`:`${p.provider}-current`);
 return identities.map((identity,index)=>{const n=identity!;return {id:ids[index],provider:pair[index].provider,nativeId:n.nativeId,generation:n.generation,host:'local',displayName:ids[index],workspace:cwd,operations:['read','send'],grants:(['read','send'] as const).flatMap(operation=>(['inbound','outbound'] as const).map(direction=>({peer:ids[1-index],operation,direction})))};});
}
export async function observeAuthorizedPair(codexNativeId:string,claudeNativeId:string,workspace:string):Promise<Registration[]>{
 return observeSessionPair([{provider:'codex',nativeId:codexNativeId},{provider:'claude',nativeId:claudeNativeId}],workspace);
}
