import {lstat,readFile,readdir,realpath} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createConnection,type Socket} from 'node:net';
import {randomUUID} from 'node:crypto';
import {isClaudeVersionAllowed,isVersionAllowed,type CompatibilityOptions} from './compat.ts';
import {observeGit} from './git-context.ts';
import type {Registration,Observation} from './protocol.ts';
import type {Observer} from './registry.ts';
import type {NativeAdapter,Envelope,Receipt} from './delivery.ts';
const exec=promisify(execFile);
export type NativeIdentity={version?:string;nativeId:string;generation:string;cwd:string;socket:string;owner?:string;pid?:number};
export type RuntimeOptions=CompatibilityOptions&{home?:string;desktopVersion?:()=>Promise<string|null>;claudeVersion?:(nativeId:string)=>Promise<string>;claudeIdentity?:(nativeId:string)=>Promise<NativeIdentity|null>;codexIdentity?:(nativeId:string)=>Promise<NativeIdentity|null>;read? :NativeAdapter['read']};
export async function command(file:string,args:string[]){return (await exec(file,args,{encoding:'utf8',timeout:5000,maxBuffer:1048576,env:{...process.env,TZ:'UTC',LC_ALL:'C',PATH:'/bin:/usr/sbin:/usr/bin'}})).stdout;}
export async function ownedSocket(path:string,strict=true){const [s,p]=await Promise.all([lstat(path),lstat(dirname(path))]);const uid=process.getuid?.();return s.isSocket()&&s.uid===uid&&(!strict||(s.mode&0o777)===0o600)&&p.isDirectory()&&p.uid===uid&&(p.mode&0o022)===0;}
export type ClaudeInspection=CompatibilityOptions&{command?:typeof command;socket?:typeof ownedSocket};
export async function findClaudeIdentityByPid(pid:number,home=homedir(),options:ClaudeInspection={},allowUnsupportedVersion=false):Promise<NativeIdentity|null>{
 try{
  if(!Number.isSafeInteger(pid)||pid<=0)return null;
  const path=join(home,'.claude','sessions',`${pid}.json`),s=await lstat(path);
  if(!s.isFile()||s.uid!==process.getuid?.()||(s.mode&0o022)!==0||s.size>65536)return null;
  const m=JSON.parse(await readFile(path,'utf8'));
  if(m.pid!==pid||typeof m.sessionId!=='string'||!m.sessionId||(typeof m.version!=='string'||!allowUnsupportedVersion&&!isClaudeVersionAllowed(m.version,options))||m.peerProtocol!==1||typeof m.procStart!=='string'||typeof m.startedAt!=='number'&&typeof m.startedAt!=='string'||typeof m.cwd!=='string'||typeof m.messagingSocketPath!=='string')return null;
  const run=options.command??command,ps=(await run('ps',['-p',String(pid),'-o','uid=,lstart='])).trim();
  const [uid,...start]=ps.split(/\s+/);
  if(Number(uid)!==process.getuid?.()||start.join(' ')!==m.procStart.replace(/\s+/g,' ').trim())return null;
  const cwd=(await run('lsof',['-a','-p',String(pid),'-d','cwd','-Fn'])).split('\n').find(x=>x.startsWith('n'))?.slice(1);
  if(!cwd||await realpath(cwd)!==await realpath(m.cwd)||!await (options.socket??ownedSocket)(m.messagingSocketPath))return null;
  const sockets=await run('lsof',['-a','-p',String(pid),'-U','-Fn']);
  if(!sockets.split('\n').includes('n'+m.messagingSocketPath))return null;
  return {version:m.version,nativeId:m.sessionId,generation:`${pid}@${m.startedAt}`,cwd:await realpath(cwd),socket:m.messagingSocketPath,pid};
 }catch{return null;}
}
export async function findClaudeIdentity(nativeId:string,home=homedir(),options:ClaudeInspection={}):Promise<NativeIdentity|null>{
 try{for(const name of await readdir(join(home,'.claude','sessions'))){if(!/^\d+\.json$/.test(name))continue;const n=await findClaudeIdentityByPid(Number(name.slice(0,-5)),home,options);if(n?.nativeId===nativeId)return n;}}catch{}return null;
}
export function sendClaudeFrame(socket:Socket,revalidate:()=>Promise<boolean>,frame:string,messageId:string):Promise<Receipt>{
 return new Promise(resolve=>{
  let attempted=false,settled=false;
  const finish=(status:Receipt['status'])=>{if(settled)return;settled=true;socket.destroy();resolve(status==='submitted'?{status,nativeMessageId:messageId}:{status});};
  socket.setTimeout(5000);
  socket.on('error',()=>finish(attempted?'unknown':'rejected'));
  socket.on('close',()=>finish(attempted?'unknown':'rejected'));
  socket.on('timeout',()=>finish(attempted?'unknown':'rejected'));
  socket.on('connect',async()=>{
   try{if(!await revalidate()||settled||socket.destroyed){finish('rejected');return;}
    attempted=true;
    socket.write(frame,error=>{if(error){finish('unknown');return;}if(socket.destroyed){finish('unknown');return;}finish('submitted');});
   }catch{finish(attempted?'unknown':'rejected');}
  });
 });
}
class IPC{
 socket:ReturnType<typeof createConnection>;buffer=Buffer.alloc(0);queue:any[]=[];waiters:Array<{resolve:(x:any)=>void;reject:(e:Error)=>void}>=[];
 constructor(path:string){this.socket=createConnection(path);this.socket.on('data',part=>{this.buffer=Buffer.concat([this.buffer,part]);while(this.buffer.length>=4){const size=this.buffer.readUInt32LE();if(size<1||size>268435456){this.socket.destroy(new Error('invalid_frame'));return;}if(this.buffer.length<size+4)return;let frame;try{frame=JSON.parse(this.buffer.subarray(4,size+4).toString());}catch{this.socket.destroy(new Error('invalid_frame'));return;}this.buffer=this.buffer.subarray(size+4);const w=this.waiters.shift();if(w)w.resolve(frame);else this.queue.push(frame);}});this.socket.on('error',e=>{for(const w of this.waiters.splice(0))w.reject(e);});}
 write(frame:unknown){const b=Buffer.from(JSON.stringify(frame)),prefix=Buffer.alloc(4);prefix.writeUInt32LE(b.length);this.socket.write(Buffer.concat([prefix,b]));}
 async next(timeoutMs=8000){if(this.queue.length)return this.queue.shift();return new Promise<any>((resolve,reject)=>{const w={resolve:(x:any)=>{clearTimeout(t);resolve(x);},reject:(e:Error)=>{clearTimeout(t);reject(e);}};const t=setTimeout(()=>{this.waiters=this.waiters.filter(x=>x!==w);reject(new Error('timeout'));},timeoutMs);this.waiters.push(w);});}
 async request(method:string,params:unknown,client:string,version:number,owner?:string,timeoutMs=8000){const requestId=randomUUID();this.write({type:'request',requestId,sourceClientId:client,version,method,params,timeoutMs:5000,...(owner?{targetClientId:owner}:{})});const deadline=Date.now()+timeoutMs;for(;;){if(Date.now()>deadline)throw new Error('timeout');const f=await this.next(Math.max(1,deadline-Date.now()));if(f.type==='response'&&f.requestId===requestId)return f;}}
 close(){this.socket.end();const timer=setTimeout(()=>this.socket.destroy(),1000);timer.unref();}
}
async function codexConnection(nativeId:string,home:string,ownerTimeoutMs=8000,versionOf?:()=>Promise<string|null>,options:CompatibilityOptions={}){const path=join(home,'.codex','ipc','ipc.sock');const {desktopVersion}=await import('./adapters/codex.ts');const version=await (versionOf??desktopVersion)();if(!version||!isVersionAllowed('codex',version,options))throw new Error('unsupported_version');if(!await ownedSocket(path,false))throw new Error('unsafe_socket');const ipc=new IPC(path);try{const initial=await ipc.request('initialize',{clientType:'claudex-native-runtime'},'initializing-client',0);if(initial.resultType!=='success')throw new Error('initialize');const client=initial.result.clientId;const found=await ipc.request('thread-owner-discovery',{hostId:'local',conversationId:nativeId},client,1,undefined,ownerTimeoutMs);if(found.resultType!=='success'||typeof found.handledByClientId!=='string')throw new Error('owner');return {ipc,client,owner:found.handledByClientId,sendSupported:found.result?.supportsUntrustedAppInput===true,path};}catch(e){ipc.close();throw e;}}
// Owner discovery never subscribes to a conversation snapshot.
export async function findCodexOwner(nativeId:string,home=homedir(),timeoutMs=8000,versionOf?:()=>Promise<string|null>,options:CompatibilityOptions={}):Promise<string|null>{
 let c:Awaited<ReturnType<typeof codexConnection>>|undefined;
 try{c=await codexConnection(nativeId,home,timeoutMs,versionOf,options);return c.owner;}catch{return null;}finally{c?.ipc.close();}
}
export async function findCodexIdentity(nativeId:string,home=homedir()):Promise<NativeIdentity|null>{let c:Awaited<ReturnType<typeof codexConnection>>|undefined;try{c=await codexConnection(nativeId,home);c.ipc.write({type:'broadcast',sourceClientId:c.client,targetClientIds:[c.owner],version:1,method:'thread-stream-following-changed',params:{hostId:'local',conversationId:nativeId,following:true}});const deadline=Date.now()+8000;for(;;){if(Date.now()>deadline)throw new Error('timeout');const f=await c.ipc.next(),p=f.params,change=p?.change;if(f.type!=='broadcast'||f.method!=='thread-stream-state-changed'||f.version!==11||f.sourceClientId!==c.owner||!f.targetClientIds?.includes(c.client)||p?.hostId!=='local'||p?.conversationId!==nativeId||change?.type!=='snapshot')continue;const state=change.conversationState;if(state?.id!==nativeId||typeof state.cwd!=='string')return null;return {nativeId,generation:c.owner,cwd:await realpath(state.cwd),socket:c.path,owner:c.owner};}}catch{return null;}finally{if(c){c.ipc.write({type:'broadcast',sourceClientId:c.client,targetClientIds:[c.owner],version:1,method:'thread-stream-following-changed',params:{hostId:'local',conversationId:nativeId,following:false}});c.ipc.close();}}}
export async function claudeVersion(nativeId:string,home=homedir()):Promise<string>{
 const {findClaudeSession}=await import('./adapters/claude.ts');
 const n=await findClaudeSession(nativeId,{home});return n&&n!=='unreadable'?n.version:'unknown';
}
export function createNativeRuntime(options:RuntimeOptions={}):{observer:Observer;adapter:NativeAdapter;checkCompatibility:(r:Pick<Registration,'provider'|'nativeId'>)=>Promise<{status:'unsupported_version';reason:string;version:string}|null>}{
 const home=options.home??homedir();const inspect=(r:Registration)=>r.provider==='claude'?(options.claudeIdentity??((id:string)=>findClaudeIdentity(id,home,options)))(r.nativeId):(options.codexIdentity??((id:string)=>findCodexIdentity(id,home)))(r.nativeId);
 const checkCompatibility=async(r:Pick<Registration,'provider'|'nativeId'>)=>{
  const version=r.provider==='codex'?await (options.desktopVersion??(await import('./adapters/codex.ts')).desktopVersion)():await (options.claudeVersion??((id:string)=>claudeVersion(id,home)))(r.nativeId);
  return version&&isVersionAllowed(r.provider==='codex'?'codex':'claude-code',version,options)?null:{status:'unsupported_version' as const,reason:version??'unknown',version:version??'unknown'};
 };
 const observer:Observer=async r=>{const n=await inspect(r);if(!n)return null;const context=await observeGit(n.cwd);const now=Date.now();return {nativeId:n.nativeId,generation:n.generation,status:'online',observedAt:now,contextObservedAt:now,source:`native:${r.provider}`,gitSource:'observeGit',cwd:n.cwd,context} satisfies Observation;};
 const adapter:NativeAdapter={read:async(target,o)=>{if(options.read)return options.read(target,o);const unsupported=await checkCompatibility(target);if(unsupported)return unsupported;const [{createReader},{createClaudeReader},{createCodexReader}]=await Promise.all([import('./adapters/read.ts'),import('./adapters/claude.ts'),import('./adapters/codex.ts')]);return createReader({claude:createClaudeReader({...options,home}),codex:createCodexReader({...options,version:options.desktopVersion,socketPath:join(home,'.codex','ipc','ipc.sock')})})(target,o);},send:async(target,envelope,authorize):Promise<Receipt>=>{const unsupported=await checkCompatibility(target);if(unsupported)return {status:'rejected',reason:unsupported.status,version:unsupported.version};const n=await inspect(target);if(!n||n.generation!==target.generation||envelope.recipient.nativeId!==target.nativeId||envelope.recipient.generation!==target.generation)return {status:'rejected'};const payload={schemaVersion:1,...envelope,humanApproval:false};if(target.provider==='claude'){return sendClaudeFrame(createConnection(n.socket),async()=>{const current=await inspect(target);return !!current&&current.generation===n.generation&&current.socket===n.socket&&(!authorize||await authorize());},JSON.stringify({type:'user',session_id:n.nativeId,from:'claudex',uuid:envelope.id,msg_id:envelope.id,message:{content:JSON.stringify(payload)}})+'\n',envelope.id);}let c:Awaited<ReturnType<typeof codexConnection>>|undefined,attempted=false;try{c=await codexConnection(n.nativeId,home,8000,options.desktopVersion,options);if(c.owner!==n.generation||authorize&&!await authorize())return {status:'rejected'};attempted=true;const response=await c.ipc.request('thread-follower-start-turn',{conversationId:n.nativeId,turnStart:{request:{threadId:n.nativeId,input:[],toolOutput:{namespace:'claudex',name:'external_message',output:JSON.stringify(payload)}},context:{inheritThreadSettings:true}}},c.client,2,c.owner);if(response.handledByClientId!==c.owner)return {status:'unknown'};return {status:response.resultType==='success'?'submitted':'unknown',nativeMessageId:envelope.id};}catch{return {status:attempted?'unknown':'rejected'};}finally{c?.ipc.close();}}};adapter.structure=async target=>{const unsupported=await checkCompatibility(target);if(unsupported)return [];if(target.provider==='claude')return (await import('./adapters/claude.ts')).readClaudeStructure(target,{...options,home});return (await import('./adapters/codex.ts')).readCodexStructure(target,{...options,version:options.desktopVersion,socketPath:join(home,'.codex','ipc','ipc.sock')});};adapter.inbound=async recipient=>{const result=await adapter.read(recipient,{limit:100}) as {status:string;items?:Array<{role:string;text:string;peer?:{namespace:string;declaredSender?:string;messageId?:string;envelope?:Envelope}}>};if(result.status!=='ok')return [];const found:Envelope[]=[];for(const item of result.items??[]){if(item.role!=='peer'||!item.peer||!['claudex','claude-peer'].includes(item.peer.namespace))continue;let e:any=item.peer.envelope;if(!e){try{e=JSON.parse(item.text);}catch{continue;}}if(!e||!item.peer.envelope&&(e.schemaVersion!==1||e.humanApproval!==false)||typeof e.id!=='string'||e.id!==item.peer.messageId||item.peer.namespace==='claude-peer'&&item.peer.declaredSender!=='claudex'||typeof e.text!=='string'||!['sender','recipient'].every(key=>e[key]&&['id','nativeId','generation'].every(field=>typeof e[key][field]==='string'&&e[key][field]))||e.replyTo!==undefined&&typeof e.replyTo!=='string')continue;found.push(e);}return found;};adapter.sentIds=async(target,ids,recipient)=>{
 if(await checkCompatibility(target))return [];
 return target.provider==='claude'?(await import('./adapters/claude.ts')).readClaudeSentIds(target,ids,recipient,{...options,home}):(await import('./adapters/codex.ts')).readCodexSentIds(target,ids,recipient,{...options,version:options.desktopVersion,socketPath:join(home,'.codex','ipc','ipc.sock')});
 };adapter.received=async target=>{
 if(await checkCompatibility(target))return [];
 const reader=target.provider==='claude'?(await import('./adapters/claude.ts')).createClaudeReader({...options,home}):(await import('./adapters/codex.ts')).createCodexReader({...options,version:options.desktopVersion,socketPath:join(home,'.codex','ipc','ipc.sock')});
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
