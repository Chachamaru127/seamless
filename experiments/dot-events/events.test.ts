import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventsPrototype,signature,publicTestSecret,testCallback,eventName,version,type Post,type Principal,type Resolve} from './events.ts';
const owner:Principal={grant:'public-fixture-grant-a',registration:'public-fixture-dot-a',active:true};
const input=()=>({name:eventName,arguments:{registration:owner.registration},delivery:{mode:'webhook',url:testCallback,secret:publicTestSecret},ttlMs:60000});
async function setup(){
 const dir=await mkdtemp(join(tmpdir(),'seamless-dot-fixture-'));let time=1791468000000;
 const calls:Parameters<Post>[0][]=[];
 let result=200,fail=false,challenge=true;
 const post:Post=async(request)=>{calls.push(request);if(fail)throw Error('fixture_disconnect');const data=JSON.parse(request.body);return {status:result,body:challenge&&data.type==='verification'?{challenge:data.challenge}:{challenge:'wrong'},remoteAddress:request.address};};
 const make=()=>new EventsPrototype(dir,post,()=>time);
 return {dir,calls,make,advance:(n:number)=>{time+=n;},set:(r:number,f=false,c=true)=>{result=r;fail=f;challenge=c;}};
}
test('signature agrees with a frozen Python hmac/hashlib vector',()=>{
 assert.equal(signature(publicTestSecret,'evt_sample',1791468000,'{"text":"sample"}'),'v1,bhUnGT5J3cuKv1Z3+1M4As26PwxppH3hfLSyDWRN2gM=');
 assert.notEqual(signature(publicTestSecret,'evt_changed',1791468000,'{"text":"sample"}'),signature(publicTestSecret,'evt_sample',1791468000,'{"text":"sample"}'));
 for(const secret of ['bad','whsec_YQ==','whsec_!'])assert.throws(()=>signature(secret,'id',0,'{}'));
});
test('discovery is a Dot-only shape and does not modify the legacy server',async()=>{
 const s=await setup(),p=s.make();assert.deepEqual(p.discover().supportedVersions,[version]);assert.equal(p.discover().resultType,'complete');
 assert.deepEqual(p.discover().capabilities.events,{});assert.deepEqual(p.discover().capabilities.extensions['io.modelcontextprotocol/events'],{});
 assert.equal(p.list(owner).events[0].name,eventName);assert.deepEqual(p.list(owner).events[0].delivery,['webhook']);
 assert.throws(()=>p.list(null),/unauthenticated/);
});
test('no verified principal: list/subscribe/unsubscribe/send reject without a POST',async()=>{
 const s=await setup(),p=s.make();
 for(const who of [null,{...owner,active:false}]){
  await assert.rejects(p.subscribe(who,input()),/unauthenticated/);
  await assert.rejects(p.unsubscribe(who,input()),/unauthenticated/);
  await assert.rejects(p.send(who,'a'.repeat(64),{id:'one',text:'fixture'}),/unauthenticated/);
 }
 assert.equal(s.calls.length,0);
});
test('a registration name does not let another grant subscribe as its owner',async()=>{
 const s=await setup(),p=s.make();const other={...owner,grant:'public-fixture-grant-b',registration:'public-fixture-dot-b'};
 await assert.rejects(p.subscribe(other,input()),/forbidden/);assert.equal(s.calls.length,0);
});
test('a callback outside the fixture whitelist is refused before challenge delivery',async()=>{
 const s=await setup();
 for(const url of ['http://receiver.example.invalid/events','https://127.0.0.1/','https://example.com/','https://receiver.example.invalid.evil.test/events']){
  const v=input();v.delivery.url=url;await assert.rejects(s.make().subscribe(owner,v),/forbidden/);
 }
 assert.equal(s.calls.length,0);
});
test('subscribe verifies the signed challenge, persists privately and refreshes one identity',async()=>{
 const s=await setup(),p=s.make(),first=await p.subscribe(owner,input());
 const request=s.calls[0],body=JSON.parse(request.body);assert.equal(body.type,'verification');
 assert.equal(request.headers['webhook-signature'],signature(publicTestSecret,request.headers['webhook-id'],Number(request.headers['webhook-timestamp']),request.body));
 assert.equal(request.headers['X-MCP-Subscription-Id'],first.id);
 s.advance(1000);const next=await s.make().subscribe(owner,input());assert.equal(first.id,next.id);assert.ok(next.refreshBefore>first.refreshBefore);
 assert.equal((await readdir(s.dir)).filter(n=>n.endsWith('.subscription')).length,1);
 assert.equal((await stat(s.dir)).mode&0o777,0o700);assert.equal((await stat(join(s.dir,first.id+'.subscription'))).mode&0o777,0o600);
});
test('wrong challenge and redirect responses cannot activate a subscription',async()=>{
 const s=await setup();s.set(200,false,false);await assert.rejects(s.make().subscribe(owner,input()),/challenge_failed/);
 assert.equal((await s.make().send(owner,s.calls[0].headers['X-MCP-Subscription-Id'],{id:'wrong-challenge',text:'fixture'})).status,'no_destination');
 s.set(302);await assert.rejects(s.make().subscribe(owner,input()),/challenge_failed/);
 assert.equal(s.calls.filter(c=>JSON.parse(c.body).type!=='verification').length,0);
});
test('verification that takes ten seconds is not activated',async()=>{
 const s=await setup();
 // A separate fixture clock isolates the expiry from transport processing.
 let time=0;const slow=new EventsPrototype(s.dir,async(r)=>{time+=10000;return {status:200,body:{challenge:JSON.parse(r.body).challenge},remoteAddress:r.address};},()=>time);
 await assert.rejects(slow.subscribe(owner,input()),/challenge_failed/);
});
test('a verified subscription survives restart and sends exactly the signed body',async()=>{
 const s=await setup(),sub=await s.make().subscribe(owner,input());s.calls.length=0;
 assert.equal((await s.make().send(owner,sub.id,{id:'request-1',text:'fixture',replyTo:'original'})).status,'accepted');
 assert.equal(s.calls.length,1);const r=s.calls[0],body=JSON.parse(r.body);assert.equal(body.eventId,'request-1');assert.equal(body.cursor,null);assert.equal(body.data.replyTo,'original');
 assert.equal(r.headers['webhook-id'],body.eventId);assert.equal(r.headers['webhook-signature'],signature(publicTestSecret,body.eventId,Number(r.headers['webhook-timestamp']),r.body));
});
for(const [code,status] of [[200,'accepted'],[404,'rejected'],[500,'unknown']] as const){
 test(`HTTP ${code} is ${status}; retry and concurrent duplicate never POST again`,async()=>{
  const s=await setup(),sub=await s.make().subscribe(owner,input());s.calls.length=0;s.set(code);
  const results=await Promise.all([s.make().send(owner,sub.id,{id:'same',text:'fixture'}),s.make().send(owner,sub.id,{id:'same',text:'fixture'})]);
  assert.deepEqual(results.map(r=>r.status).sort(),['duplicate',status].sort());assert.equal(s.calls.length,1);
  assert.equal((await s.make().send(owner,sub.id,{id:'same',text:'fixture'})).status,'duplicate');assert.equal(s.calls.length,1);
 });
}
test('disconnect leaves an unknown durable reservation; a restart cannot resend',async()=>{
 const s=await setup(),sub=await s.make().subscribe(owner,input());s.calls.length=0;s.set(200,true);
 assert.equal((await s.make().send(owner,sub.id,{id:'uncertain',text:'fixture'})).status,'unknown');
 assert.equal((await s.make().send(owner,sub.id,{id:'uncertain',text:'fixture'})).status,'duplicate');assert.equal(s.calls.length,1);
 const record=(await readdir(s.dir)).find(n=>n.endsWith('.delivery'))!;assert.equal(JSON.parse(await readFile(join(s.dir,record),'utf8')).status,'unknown');
});
test('reservation is already synced when the transport is entered',async()=>{
 const s=await setup(),sub=await s.make().subscribe(owner,input());
 const p=new EventsPrototype(s.dir,async(r)=>{
  const name=(await readdir(s.dir)).find(n=>n.endsWith('.delivery'))!;
  assert.equal(JSON.parse(await readFile(join(s.dir,name),'utf8')).status,'unknown');
  return {status:200,remoteAddress:r.address};
 },()=>1791468000000);
 assert.equal((await p.send(owner,sub.id,{id:'reserved-before-post',text:'fixture'})).status,'accepted');
});
test('exact expiry, revoked owner, wrong grant and unsubscribe all stop delivery',async()=>{
 const s=await setup(),sub=await s.make().subscribe(owner,input());s.calls.length=0;s.advance(60000);
 assert.equal((await s.make().send(owner,sub.id,{id:'expired',text:'fixture'})).status,'no_destination');
 await assert.rejects(s.make().send({...owner,active:false},sub.id,{id:'revoked',text:'fixture'}),/unauthenticated/);
 assert.equal((await s.make().send({...owner,grant:'other-grant'},sub.id,{id:'other',text:'fixture'})).status,'no_destination');
 await s.make().unsubscribe(owner,input());await s.make().unsubscribe(owner,input());
 assert.equal((await s.make().send(owner,sub.id,{id:'removed',text:'fixture'})).status,'no_destination');assert.equal(s.calls.length,0);
});
test('failed secret rotation disables the previous verified subscription',async()=>{
 const s=await setup(),sub=await s.make().subscribe(owner,input());
 const rotated=input();rotated.delivery.secret='whsec_'+Buffer.from('abcdef0123456789abcdef0123456789').toString('base64');
 s.set(200,false,false);await assert.rejects(s.make().subscribe(owner,rotated),/challenge_failed/);s.calls.length=0;
 assert.equal((await s.make().send(owner,sub.id,{id:'rotation',text:'fixture'})).status,'no_destination');assert.equal(s.calls.length,0);
});
test('oversized event is refused before a reservation or POST',async()=>{
 const s=await setup(),sub=await s.make().subscribe(owner,input());s.calls.length=0;
 await assert.rejects(s.make().send(owner,sub.id,{id:'big',text:'x'.repeat(262144)}),/event_too_large/);
 assert.equal(s.calls.length,0);assert.equal((await readdir(s.dir)).filter(n=>n.endsWith('.delivery')).length,0);
});
test('failed refresh with the same secret preserves delivery and the original expiry',async()=>{
 const s=await setup(),sub=await s.make().subscribe(owner,input());
 const path=join(s.dir,sub.id+'.subscription'),before=await readFile(path,'utf8');
 s.advance(1000);s.set(200,false,false);
 await assert.rejects(s.make().subscribe(owner,input()),/challenge_failed/);
 assert.equal(await readFile(path,'utf8'),before);
 s.set(200);s.calls.length=0;
 assert.equal((await s.make().send(owner,sub.id,{id:'still-valid',text:'fixture'})).status,'accepted');
 assert.equal(s.calls.length,1);
 s.advance(59000);
 assert.equal((await s.make().send(owner,sub.id,{id:'not-extended',text:'fixture'})).status,'no_destination');
});
test('fixture DNS rejects private results and rebinding and pins a public destination',async()=>{
 const s=await setup();let addresses:readonly string[]=['93.184.216.34'],resolutions=0,posts=0;
 const resolve:Resolve=async(hostname)=>{resolutions++;assert.equal(hostname,'receiver.example.invalid');return addresses;};
 let mismatched=false;
 const p=new EventsPrototype(s.dir,async(r)=>{
  posts++;assert.equal(r.address,addresses[0]);assert.equal(r.hostname,'receiver.example.invalid');assert.equal(r.redirect,'error');
  return {status:200,body:{challenge:JSON.parse(r.body).challenge},remoteAddress:mismatched?'127.0.0.1':r.address};
 },()=>1791468000000,resolve);
 for(const unsafe of ['127.0.0.1','10.1.2.3','172.16.1.2','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','224.0.0.1','::1','fc00::1','fd12:3456::1','fe80::1','::ffff:127.0.0.1','::ffff:192.168.1.1','2001:db8::1','not-an-ip']){
  addresses=[unsafe];await assert.rejects(p.subscribe(owner,input()),/callback_error/);
 }
 addresses=['93.184.216.34','127.0.0.1'];await assert.rejects(p.subscribe(owner,input()),/callback_error/);
 assert.equal(posts,0);
 addresses=['93.184.216.34'];const before=resolutions,sub=await p.subscribe(owner,input());assert.equal(resolutions,before+1);assert.equal(posts,1);
 // The next resolution changing to loopback is blocked before transport entry.
 addresses=['127.0.0.1'];await assert.rejects(p.subscribe(owner,input()),/callback_error/);assert.equal(posts,1);
 addresses=['93.184.216.34'];mismatched=true;await assert.rejects(p.subscribe(owner,input()),/callback_error/);
 // A mock transport reporting a different connected address cannot verify a callback.
 assert.equal((JSON.parse(await readFile(join(s.dir,sub.id+'.subscription'),'utf8'))).id,sub.id);
 const fresh=await setup(),other=new EventsPrototype(fresh.dir,async(r)=>({status:200,body:{challenge:JSON.parse(r.body).challenge},remoteAddress:'127.0.0.1'}),()=>1791468000000,resolve);
 await assert.rejects(other.subscribe(owner,input()),/callback_error/);
 assert.equal((await other.send(owner,sub.id,{id:'rebound',text:'fixture'})).status,'no_destination');
});
test('ten second deadline aborts an in-flight mock and preserves a same-secret subscription',{timeout:15000},async()=>{
 const s=await setup(),sub=await s.make().subscribe(owner,input());let aborted=false,entered=false;
 const p=new EventsPrototype(s.dir,async(r)=>new Promise((_resolve,reject)=>{
  entered=true;
  r.signal.addEventListener('abort',()=>{aborted=true;reject(Error('fixture_aborted'));},{once:true});
 }),()=>1791468000000);
 const began=Date.now();await assert.rejects(p.subscribe(owner,input()),/callback_error/);
 assert.ok(entered&&aborted);assert.ok(Date.now()-began>=9900);
 assert.equal((await s.make().send(owner,sub.id,{id:'after-timeout',text:'fixture'})).status,'accepted');
});
test('no destination consumes no reservation and the same event may be sent after subscribing',async()=>{
 const s=await setup(),sub=await s.make().subscribe(owner,input());await s.make().unsubscribe(owner,input());s.calls.length=0;
 assert.equal((await s.make().send(owner,sub.id,{id:'later',text:'fixture'})).status,'no_destination');
 assert.equal((await readdir(s.dir)).filter(n=>n.endsWith('.delivery')).length,0);assert.equal(s.calls.length,0);
 await s.make().subscribe(owner,input());s.calls.length=0;
 assert.equal((await s.make().send(owner,sub.id,{id:'later',text:'fixture'})).status,'accepted');
 assert.equal((await s.make().send(owner,sub.id,{id:'later',text:'fixture'})).status,'duplicate');assert.equal(s.calls.length,1);
});
