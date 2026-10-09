import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {mkdir,open,readFile,rename,lstat,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {isIP} from 'node:net';

export const version='2026-07-28';
export const eventName='seamless.message.created';
export const testCallback='https://receiver.example.invalid/events';
export const publicTestSecret='whsec_'+Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');
export type Principal={grant:string;registration:string;active:boolean};
type Subscription={id:string;grant:string;registration:string;name:string;arguments:{registration:string};url:string;secret:string;refreshBefore:number};
type Response={status:number;body?:unknown;remoteAddress:string};
export type Post=(request:{url:string;body:string;headers:Record<string,string>;address:string;hostname:string;redirect:'error';signal:AbortSignal})=>Promise<Response>;
export type Resolve=(hostname:string,signal:AbortSignal)=>Promise<readonly string[]>;
type Message={id:string;text:string;replyTo?:string};
const capabilities={tools:{},events:{},extensions:{'io.modelcontextprotocol/events':{}}};
const canonical=(v:Record<string,string>)=>JSON.stringify(Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])));
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
function principal(p:Principal|null):Principal{
 if(!p?.active||!p.grant||!p.registration)throw Error('unauthenticated');
 return p;
}
export function signature(secret:string,id:string,time:number,body:string):string{
 if(!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret))throw Error('invalid_secret');
 const key=Buffer.from(secret.slice(6),'base64');
 if(key.length<24||key.length>64||key.toString('base64')!==secret.slice(6))throw Error('invalid_secret');
 if(!Number.isSafeInteger(time))throw Error('invalid_time');
 return 'v1,'+createHmac('sha256',key).update(`${id}.${time}.${body}`).digest('base64');
}
function signed(secret:string,id:string,at:number,body:string,subscription:string){
 const time=Math.floor(at/1000);
 return {'Content-Type':'application/json','webhook-id':id,'webhook-timestamp':String(time),'webhook-signature':signature(secret,id,time,body),'X-MCP-Subscription-Id':subscription};
}
function publicAddress(address:string){
 if(isIP(address)===4){
  const [a,b,c]=address.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||a===100&&b>=64&&b<=127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===0||b===168||b===88&&c===99)||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
 }
 if(isIP(address)!==6)return false;
 const normalized=new URL(`https://[${address}]/`).hostname.slice(1,-1);
 const first=parseInt(normalized.split(':')[0],16);
 return first>=0x2000&&first<=0x3fff&&!/^2001:(db8|0|10|20):/.test(normalized);
}
async function privateDirectory(dir:string){
 await mkdir(dir,{recursive:true,mode:0o700});
 const s=await lstat(dir);
 if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o777)!==0o700||s.uid!==process.getuid?.())throw Error('unsafe_store');
}
async function save(path:string,value:unknown){
 const tmp=path+'.'+randomUUID();const file=await open(tmp,'wx',0o600);
 try{await file.writeFile(JSON.stringify(value));await file.sync();}finally{await file.close();}
 await rename(tmp,path);
}
// The only caller of this experiment is its test. No OAuth result is manufactured here.
export class EventsPrototype{
 private dir:string;private post:Post;private now:()=>number;private resolve:Resolve;
 constructor(dir:string,post:Post,now:()=>number=Date.now,resolve:Resolve=async()=>['93.184.216.34']){this.dir=dir;this.post=post;this.now=now;this.resolve=resolve;}
 private async request(url:string,body:string,headers:Record<string,string>){
  const controller=new AbortController();
  let timer:ReturnType<typeof setTimeout>;
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('callback_timeout'));},10000);});
  try{return await Promise.race([timeout,(async()=>{
   const hostname=new URL(url).hostname;
   const addresses=await this.resolve(hostname,controller.signal);
   if(controller.signal.aborted)throw Error('callback_timeout');
   if(!addresses.length||addresses.some(address=>!publicAddress(address)))throw Error('unsafe_address');
   const address=addresses[0];
   const response=await this.post({url,body,headers,address,hostname,redirect:'error',signal:controller.signal});
   if(response.remoteAddress!==address)throw Error('address_changed');
   return response;
  })()]);}finally{clearTimeout(timer!);}
 }
 private async destination(p:Principal,id:string){
  let sub:Subscription;
  try{sub=JSON.parse(await readFile(join(this.dir,id+'.subscription'),'utf8'));}catch{return undefined;}
  return sub.id===id&&sub.grant===p.grant&&sub.registration===p.registration&&sub.url===testCallback&&sub.refreshBefore>this.now()?sub:undefined;
 }
 discover(){return {resultType:'complete',supportedVersions:[version],capabilities};}
 list(p:Principal|null){principal(p);return {events:[{name:eventName,description:'A peer message is ready for this registered connection.',delivery:['webhook'],inputSchema:{type:'object',properties:{registration:{type:'string'}},required:['registration'],additionalProperties:false},payloadSchema:{type:'object',properties:{id:{type:'string'},text:{type:'string'},replyTo:{type:'string'}},required:['id','text'],additionalProperties:false}}]};}
 private identity(p:Principal,url:string,args:{registration:string}){
  if(url!==testCallback||args.registration!==p.registration||Object.keys(args).length!==1)throw Error('forbidden');
  return hash(JSON.stringify([p.grant,p.registration,url,eventName,canonical(args)]));
 }
 async subscribe(who:Principal|null,input:{name:string;arguments:{registration:string};delivery:{mode:string;url:string;secret:string};ttlMs?:number}){
  const p=principal(who);
  if(input.name!==eventName||input.delivery.mode!=='webhook')throw Error('invalid_subscription');
  const ttl=input.ttlMs??3600000;
  if(!Number.isSafeInteger(ttl)||ttl<1||ttl>86400000)throw Error('invalid_ttl');
  const id=this.identity(p,input.delivery.url,input.arguments);
  const secret=input.delivery.secret;
  signature(secret,'validate',0,'');
  await privateDirectory(this.dir);
  // A failed refresh with the same secret keeps a still-valid subscription.
  const existing=await this.destination(p,id);
  if(existing?.secret!==secret)await save(join(this.dir,id+'.subscription'),{id,pending:true});
  const challenge=randomUUID(),body=JSON.stringify({type:'verification',challenge});
  const headers=signed(secret,'verification_'+randomUUID(),this.now(),body,id);
  const began=this.now();
  let response:Response;
  try{response=await this.request(input.delivery.url,body,headers);}catch{throw Error('callback_error');}
  const echo=(response.body as {challenge?:unknown})?.challenge;
  if(response.status<200||response.status>=300||typeof echo!=='string'||echo.length!==challenge.length||!timingSafeEqual(Buffer.from(echo),Buffer.from(challenge))||this.now()-began>=10000)throw Error('challenge_failed');
  const sub:Subscription={id,grant:p.grant,registration:p.registration,name:eventName,arguments:input.arguments,url:input.delivery.url,secret,refreshBefore:this.now()+ttl};
  await save(join(this.dir,id+'.subscription'),sub);
  return {id,refreshBefore:new Date(sub.refreshBefore).toISOString(),cursor:null,truncated:false};
 }
 async unsubscribe(who:Principal|null,input:{name:string;arguments:{registration:string};delivery:{mode:string;url:string}}){
  const p=principal(who);
  if(input.name!==eventName||input.delivery.mode!=='webhook')throw Error('invalid_subscription');
  const id=this.identity(p,input.delivery.url,input.arguments);
  await privateDirectory(this.dir);
  // A tombstone prevents delivery and makes repeated unsubscribe harmless.
  await save(join(this.dir,id+'.subscription'),{id,removed:true});
  return {};
 }
 async send(who:Principal|null,subscriptionId:string,message:Message){
  const p=principal(who);
  if(!/^[a-f0-9]{64}$/.test(subscriptionId)||!message.id||typeof message.text!=='string'||message.replyTo!==undefined&&typeof message.replyTo!=='string')throw Error('invalid_event');
  const body=JSON.stringify({eventId:message.id,name:eventName,timestamp:new Date(this.now()).toISOString(),data:message,cursor:null});
  if(Buffer.byteLength(body)>262144)throw Error('event_too_large');
  await privateDirectory(this.dir);
  if(!await this.destination(p,subscriptionId))return {status:'no_destination'};
  const reservation=join(this.dir,hash(JSON.stringify([p.grant,subscriptionId,message.id]))+'.delivery');
  let file;
  try{file=await open(reservation,'wx',0o600);}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')return {status:'duplicate'};throw e;}
  try{await file.writeFile(JSON.stringify({id:message.id,status:'unknown',at:this.now()}));await file.sync();}finally{await file.close();}
  const finish=async(status:string)=>{await save(reservation,{id:message.id,status,at:this.now()});return {status};};
  const sub=await this.destination(p,subscriptionId);
  if(!sub){await unlink(reservation);return {status:'no_destination'};}
  // Snapshot the verified secret and destination; no automatic retry after an uncertain response.
  let response:Response;
  try{response=await this.request(sub.url,body,signed(sub.secret,message.id,this.now(),body,sub.id));}catch{return finish('unknown');}
  return finish(response.status>=200&&response.status<300?'accepted':response.status>=400&&response.status<500?'rejected':'unknown');
 }
}
