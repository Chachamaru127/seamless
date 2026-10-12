import {mkdtemp,writeFile,rm,mkdir,realpath,chmod,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHmac,createHash,randomBytes} from 'node:crypto';
import {createAutomatic} from '../../src/automatic.ts';
import {signingInput,type SignedEnvelope,type SignedFields} from '../../src/signed-envelope.ts';
import type {Envelope} from '../../src/delivery.ts';
import type {SessionIdentity} from '../../src/sessions-scan.ts';

// A Mac with a few fake conversations and a registered outside sender ("chachamaru"). The Bot's signing is done here, in the
// test: src has no signing function. Every key is made up inside the test (random bytes), never read from the environment.
export type Cleanup={after:(fn:()=>Promise<void>)=>void};
export const T0=Date.parse('2026-10-09T12:00:00Z');
export const sign=(key:string,fields:SignedFields):SignedEnvelope=>({...fields,signature:createHmac('sha256',key).update(signingInput(fields)).digest('hex')});
export const isoSeconds=(ms:number)=>new Date(Math.floor(ms/1000)*1000).toISOString().slice(0,19)+'Z';
export const peerRecord=(over:Record<string,unknown>={}):Record<string,unknown>=>({name:'chachamaru',displayName:'茶々丸',product:'grok-bot',addressEnv:'CHACHAMARU_WEBHOOK_URL',sendKeyEnv:'CHACHAMARU_SEND_KEY',receiveKeyEnv:'CHACHAMARU_RECV_KEY',keyVersion:1,operations:{read:false,send:true},...over});
export const secondRecord=(over:Record<string,unknown>={}):Record<string,unknown>=>peerRecord({name:'second',displayName:'二番目',addressEnv:'SECOND_WEBHOOK_URL',sendKeyEnv:'SECOND_SEND_KEY',receiveKeyEnv:'SECOND_RECV_KEY',...over});
export type FixtureTarget=SessionIdentity;
// A request a Mac conversation made to a registered outside sender earlier (the reservation record that sending to the Bot
// leaves). Written the way the delivery writes one: named by the sender and the request id, private to the owner.
export async function requestToBot(reservations:string,r:{id:string;from:{provider:'claude'|'codex'|'grok';nativeId:string;generation:string;cwd:string};bot?:string;botKeyVersion?:number;replyTo?:string;status?:string;at?:number}){
 await mkdir(reservations,{recursive:true,mode:0o700});await chmod(reservations,0o700);
 const bot=r.bot??'chachamaru',party=(p:{provider:string;nativeId:string;generation:string;cwd:string})=>({id:`${p.provider}:${p.nativeId}`,...p});
 const record={hash:createHash('sha256').update(r.id).digest('hex'),status:r.status??'submitted',at:r.at??T0-60_000,id:r.id,sender:party(r.from),recipient:{id:`grok-bot:${bot}`,provider:'grok-bot',nativeId:bot,generation:String(r.botKeyVersion??1),cwd:''},...(r.replyTo?{replyTo:r.replyTo}:{})};
 const name=createHash('sha256').update(JSON.stringify([r.from.provider,'local',r.from.nativeId,r.id])).digest('hex')+'.json';
 await writeFile(join(reservations,name),JSON.stringify(record),{mode:0o600});
}
export async function externalFixture(t:Cleanup,options:{outcome?:'submitted'|'unknown'|'cut'|'rejected'}={}){
 const home=await realpath(await mkdtemp(join(tmpdir(),'seamless-ext-')));t.after(()=>rm(home,{recursive:true,force:true}));
 const work=join(home,'work'),other=join(home,'other');
 await mkdir(work,{recursive:true});await mkdir(other,{recursive:true});await mkdir(join(home,'.seamless'),{recursive:true,mode:0o700});
 let now=T0,counter=0,writes=0,diagnostics:string[]=[],outcome:'submitted'|'unknown'|'cut'|'rejected'=options.outcome??'submitted',beforeWrite:()=>Promise<void>=async()=>{};
 const keys={recv:randomBytes(32).toString('hex'),send:randomBytes(32).toString('hex'),secondRecv:randomBytes(32).toString('hex'),secondSend:randomBytes(32).toString('hex')};
 const env:NodeJS.ProcessEnv={CHACHAMARU_WEBHOOK_URL:'https://bot.invalid/hook',CHACHAMARU_SEND_KEY:keys.send,CHACHAMARU_RECV_KEY:keys.recv,SECOND_WEBHOOK_URL:'https://second.invalid/hook',SECOND_SEND_KEY:keys.secondSend,SECOND_RECV_KEY:keys.secondRecv};
 const peersPath=join(home,'.seamless','peers.json'),limitsPath=join(home,'.seamless','limits.json'),reservations=join(home,'.seamless','reservations'),nonces=join(home,'.seamless','nonces');
 const writePeers=async(...peers:Array<Record<string,unknown>>)=>{await writeFile(peersPath,JSON.stringify({version:1,peers}),{mode:0o600});await chmod(peersPath,0o600);};
 await writePeers(peerRecord({scope:[work]}));
 const targets:FixtureTarget[]=[
  {provider:'claude',nativeId:'claude-b',generation:'42@100',cwd:work,socket:'unused',version:'2.1.286'},
  {provider:'codex',nativeId:'codex-c',generation:'owner-1',cwd:work,socket:'unused'},
  {provider:'grok',nativeId:'grok-g',generation:'501@2026-10-09T10:00:00Z',cwd:work,socket:''},
  {provider:'claude',nativeId:'claude-out',generation:'43@100',cwd:other,socket:'unused',version:'2.1.286'},
 ];
 const sent:Envelope[]=[];
 const adapter={read:async()=>({status:'ok',items:[]}),structure:async()=>[],
  send:async(_t:unknown,e:Envelope,authorize?:()=>Promise<boolean>)=>{await beforeWrite();if(authorize&&!await authorize())return {status:'rejected' as const};if(outcome==='rejected')return {status:'rejected' as const};writes++;sent.push(e);if(outcome==='cut')throw new Error('connection reset after the write');return {status:outcome,nativeMessageId:e.id};}};
 const make=(extra:Record<string,unknown>={})=>createAutomatic({home,env,diagnose:(line:string)=>{diagnostics.push(line);},clock:{now:()=>now,sleep:async()=>{}},scan:async()=>({sessions:targets.map(n=>({...n})),codexWorkspace:'observed' as const}),
  inspect:async n=>{const f=targets.find(x=>x.nativeId===n.nativeId&&x.provider===n.provider);return f?{...f}:null;},scanOptions:{git:async cwd=>({state:'no_git',workspace:cwd})},adapter,
  // bot-send here stands for the Bot itself; whether a command is the Bot is tested in tests/bot-executor.test.ts and tests/bot-send.test.ts.
  botExecutor:async()=>null,...extra});
 const automatic=make();
 // A signed envelope with sensible defaults; `key` signs with another key, and a field given in `over` replaces the default before signing.
 const envelope=(over:Partial<SignedFields>&{key?:string}={}):SignedEnvelope=>{
  const {key=keys.recv,...rest}=over;
  return sign(key,{sender:'chachamaru',keyVersion:1,recipient:'claude:claude-b:42@100',id:`req-${++counter}`,text:`hello ${counter}`,signedAt:isoSeconds(now),nonce:randomBytes(16).toString('base64url'),...rest});
 };
 const call=(method:string,input:unknown,name='chachamaru',using=automatic)=>using(method,input,{kind:'cli',external:{name}});
 const count=async(dir:string,pattern=/^[0-9a-f]{64}\.json$/)=>(await readdir(dir).catch(()=>[])).filter(n=>pattern.test(n)).length;
 return {home,work,other,keys,env,peersPath,limitsPath,reservations,nonces,writePeers,targets,sent,automatic,make,envelope,call,adapter,
  setNow:(ms:number)=>{now=ms;},now:()=>now,advance:(ms:number)=>{now+=ms;},
  setOutcome:(v:'submitted'|'unknown'|'cut'|'rejected')=>{outcome=v;},beforeWrite:(fn:()=>Promise<void>)=>{beforeWrite=fn;},
  writes:()=>writes,reserved:()=>count(reservations),noncesWritten:()=>count(nonces),
  diagnostics,
  readNonces:async()=>Promise.all((await readdir(nonces).catch(()=>[])).filter(n=>/^[0-9a-f]{64}\.json$/.test(n)).map(async n=>JSON.parse(await readFile(join(nonces,n),'utf8'))))};
}
