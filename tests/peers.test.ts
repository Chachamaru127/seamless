import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir,realpath,symlink,chmod,stat,cp,copyFile} from 'node:fs/promises';
import {readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomUUID,randomBytes} from 'node:crypto';
import {readPeers,validPeers,peerStatus,peerUse,peerOperations,peerId,scopeAllows,externalPeers,peerEnvSlots,type Peer} from '../src/peers.ts';
import {createAutomatic,issueTicket} from '../src/automatic.ts';
import {createMcp} from '../src/mcp.ts';
import {writeLimits,unrestricted} from '../src/limits.ts';
import type {Caller} from '../src/caller.ts';
import type {SessionIdentity} from '../src/sessions-scan.ts';
import type {Envelope} from '../src/delivery.ts';
import {fakeBin} from './support/fake-bin.ts';

type Cleanup={after:(fn:()=>Promise<void>)=>void};
const good=(over:Record<string,unknown>={}):Record<string,unknown>=>({name:'chachamaru',displayName:'茶々丸',product:'grok-bot',addressEnv:'CHACHAMARU_WEBHOOK_URL',sendKeyEnv:'CHACHAMARU_SEND_KEY',receiveKeyEnv:'CHACHAMARU_RECV_KEY',keyVersion:1,scope:'all',...over});
const roster=(...peers:object[])=>({version:1,peers});
// A second registration whose three variable names differ from good()'s, so only the field under test can make a roster invalid.
const second=(over:Record<string,unknown>={}):Record<string,unknown>=>good({name:'second',displayName:'二番目',addressEnv:'SECOND_ADDR',sendKeyEnv:'SECOND_SEND',receiveKeyEnv:'SECOND_RECV',...over});
async function tmp(t:Cleanup,prefix='cldx-peers-'){const dir=await realpath(await mkdtemp(join(tmpdir(),prefix)));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
async function put(path:string,value:unknown,mode=0o600){await writeFile(path,typeof value==='string'?value:JSON.stringify(value),{mode});await chmod(path,mode);}
async function fixture(t:Cleanup){const dir=await tmp(t),path=join(dir,'peers.json');return {dir,path,write:(value:unknown,mode?:number)=>put(path,value,mode)};}

test('a valid roster reads with every field intact and re-reads fresh each time',async t=>{
 const f=await fixture(t),a=good({operations:{read:false,send:true},scope:['/work/a','/work/b']}),b=good({name:'second',addressEnv:'S_ADDR',sendKeyEnv:'S_SEND',receiveKeyEnv:'S_RECV',keyVersion:7,revoked:{at:'2026-10-09T01:02:03.456+09:00'}});
 await f.write(roster(a,b));
 const first=await readPeers(f.path);assert.equal(first.status,'ok');if(first.status!=='ok')return;
 assert.deepEqual(first.value,roster(a,b));assert.match(first.hash,/^[0-9a-f]{64}$/);
 await f.write(roster(a));
 const second=await readPeers(f.path);assert.equal(second.status,'ok');if(second.status!=='ok')return;
 assert.equal(second.value.peers.length,1);assert.notEqual(second.hash,first.hash);
 await rm(f.path);assert.deepEqual(await readPeers(f.path),{status:'absent',hash:null});
});
test('a missing roster is absent; broken JSON and a directory are unusable',async t=>{
 const f=await fixture(t);assert.deepEqual(await readPeers(f.path),{status:'absent',hash:null});
 await f.write('{broken');assert.deepEqual(await readPeers(f.path),{status:'unusable'});
 await rm(f.path);await mkdir(f.path);assert.deepEqual(await readPeers(f.path),{status:'unusable'});
});
for(const mode of [0o644,0o640,0o604,0o660,0o400,0o700,0o000])test(`a roster with mode ${mode.toString(8).padStart(3,'0')} is unusable`,async t=>{
 const f=await fixture(t);await f.write(roster(good()),mode);assert.deepEqual(await readPeers(f.path),{status:'unusable'});
});
test('a roster owned by someone else is unusable (same private-file check as limits.json)',async t=>{
 const f=await fixture(t);await f.write(roster(good()));assert.equal((await readPeers(f.path)).status,'ok');
 const real=process.getuid!;
 try{(process as {getuid:()=>number}).getuid=()=>real.call(process)+1;assert.deepEqual(await readPeers(f.path),{status:'unusable'});}
 finally{(process as {getuid:()=>number}).getuid=real;}
 assert.equal((await readPeers(f.path)).status,'ok');
});
test('a symlink is unusable even when it points at a valid private roster',async t=>{
 const f=await fixture(t),target=join(f.dir,'real.json');await put(target,roster(good()));await symlink(target,f.path);
 assert.deepEqual(await readPeers(f.path),{status:'unusable'});
});
const required=['name','displayName','product','addressEnv','sendKeyEnv','receiveKeyEnv','keyVersion'];
const long=(n:number,c='a')=>c.repeat(n);
const badPeers:Array<[string,unknown]>=[
 ['null',null],['array',[]],['string','x'],['number',1],['no version',{peers:[]}],['version 2',{version:2,peers:[]}],['no peers',{version:1}],['peers not an array',{version:1,peers:{}}],
 ['unknown top-level key',{version:1,peers:[],extra:1}],
 ['unknown entry key',roster(good({extra:1}))],
 ['a key value written into the roster',roster(good({sendKey:'abc'}))],
 ['an address value written into the roster',roster(good({address:'https://example.invalid/hook'}))],
 ...required.map(k=>[`missing ${k}`,roster(Object.fromEntries(Object.entries(good()).filter(([x])=>x!==k)))] as [string,unknown]),
 ...['','Upper','under_score','a b','あ','a.b','a/b','a:b','..','a\n','a\0b',long(64),5,null].map(v=>[`name ${JSON.stringify(v)}`,roster(good({name:v}))] as [string,unknown]),
 ...['',long(65),5,null].map(v=>[`displayName ${JSON.stringify(v)?.slice(0,12)}`,roster(good({displayName:v}))] as [string,unknown]),
 ...['grok','chatgpt-dot','GROK-BOT',5,null].map(v=>[`product ${JSON.stringify(v)}`,roster(good({product:v}))] as [string,unknown]),
 ...['addressEnv','sendKeyEnv','receiveKeyEnv'].flatMap(k=>['lower','1ABC','','A-B','A B','A.B','A$(x)','A[0]','A\nB','A;B','A`x`',long(129,'A'),5,null].map(v=>[`${k} ${JSON.stringify(v)?.slice(0,12)}`,roster(good({[k]:v}))] as [string,unknown])),
 ['send key equals receive key',roster(good({sendKeyEnv:'SAME',receiveKeyEnv:'SAME'}))],
 ['address equals send key',roster(good({addressEnv:'SAME',sendKeyEnv:'SAME'}))],
 ['address equals receive key',roster(good({addressEnv:'SAME',receiveKeyEnv:'SAME'}))],
 ['all three equal',roster(good({addressEnv:'SAME',sendKeyEnv:'SAME',receiveKeyEnv:'SAME'}))],
 ...[0,-1,1.5,'1',null,2**53].map(v=>[`keyVersion ${String(v)}`,roster(good({keyVersion:v}))] as [string,unknown]),
 ...[{}, {at:'yesterday'},{at:'2026-10-09'},{at:'2026-13-01T00:00:00Z'},{at:'2026-10-09T00:00:00Z',extra:1},null,true,'x',{at:5}].map(v=>[`revoked ${JSON.stringify(v)}`,roster(good({revoked:v}))] as [string,unknown]),
 ...[{read:true},{read:'false'},{read:false,send:'yes'},{send:1},{send:true,extra:1},[],null,'send'].map(v=>[`operations ${JSON.stringify(v)}`,roster(good({operations:v}))] as [string,unknown]),
 ...[[],'ALL','any',['relative'],['/a/../b'],['/a/./b'],['/a/'],['/'],[5],[''],['/a\0b'],null,{},5,['/a',5]].map(v=>[`scope ${JSON.stringify(v)}`,roster(good({scope:v}))] as [string,unknown]),
 ['duplicate names',roster(good(),good({addressEnv:'X_A',sendKeyEnv:'X_S',receiveKeyEnv:'X_R'}))],
 // Across registrations (AC5: a key must belong to one sender, and a send key is never another registration's receive key).
 ['two registrations share a receive key',roster(good(),second({receiveKeyEnv:'CHACHAMARU_RECV_KEY'}))],
 ['two registrations share a send key',roster(good(),second({sendKeyEnv:'CHACHAMARU_SEND_KEY'}))],
 ['two registrations share an address',roster(good(),second({addressEnv:'CHACHAMARU_WEBHOOK_URL'}))],
 ['one registration send key is the other receive key',roster(good(),second({sendKeyEnv:'CHACHAMARU_RECV_KEY'}))],
 ['one registration receive key is the other send key',roster(good(),second({receiveKeyEnv:'CHACHAMARU_SEND_KEY'}))],
 ['the two registrations swap their keys',roster(good(),second({sendKeyEnv:'CHACHAMARU_RECV_KEY',receiveKeyEnv:'CHACHAMARU_SEND_KEY'}))],
 ['one registration address is the other key',roster(good(),second({addressEnv:'CHACHAMARU_SEND_KEY'}))],
];
test('every malformed shape makes the whole roster unusable (fail closed), and validPeers agrees',async t=>{
 const f=await fixture(t);
 for(const [label,value] of badPeers){
  await f.write(value);assert.deepEqual(await readPeers(f.path),{status:'unusable'},label);assert.equal(validPeers(value),false,label);
 }
});
const okPeers:Array<[string,Record<string,unknown>]>=[
 ['minimal, scope unset',(()=>{const g=good();delete g.scope;return g;})()],
 ['name 1 and 63 chars',good({name:'a'})],['name 63',good({name:long(63)})],['name digits and hyphen',good({name:'0-9-z'})],
 ['displayName 64 code points',good({displayName:long(64,'茶')})],
 ['env 128 chars and leading underscore',good({addressEnv:long(128,'A'),sendKeyEnv:'_X1',receiveKeyEnv:'Y_2'})],
 ['keyVersion large',good({keyVersion:2**31})],
 ['revoked with millis and offset',good({revoked:{at:'2026-10-09T01:02:03.456+09:00'}})],['revoked Z',good({revoked:{at:'2026-10-09T01:02:03Z'}})],
 ['operations {}',good({operations:{}})],['operations send only',good({operations:{send:true}})],['operations read false only',good({operations:{read:false}})],
 ['scope all',good({scope:'all'})],['scope list',good({scope:['/a','/a/b','/c']})],
];
test('well-formed registrations are accepted (the validator is not simply rejecting everything)',()=>{
 for(const [label,p] of okPeers)assert.equal(validPeers(roster(p)),true,label);
 assert.equal(validPeers({version:1,peers:[]}),true);
 assert.equal(validPeers(roster(good(),second())),true,'two registrations with six different names');
});

test('revoked is not usable and a missing scope is not usable, with the reason; the rest of the roster stays whole',()=>{
 const live=good({scope:['/w']}) as unknown as Peer,revoked=good({name:'old',addressEnv:'OLD_A',sendKeyEnv:'OLD_S',receiveKeyEnv:'OLD_R',revoked:{at:'2026-10-01T00:00:00Z'},operations:{send:true}}) as unknown as Peer;
 const unset=(()=>{const g=good({name:'unset',addressEnv:'UNSET_A',sendKeyEnv:'UNSET_S',receiveKeyEnv:'UNSET_R',operations:{send:true}});delete g.scope;return g as unknown as Peer;})();
 const both=(()=>{const g=good({name:'both',addressEnv:'BOTH_A',sendKeyEnv:'BOTH_S',receiveKeyEnv:'BOTH_R',revoked:{at:'2026-10-01T00:00:00Z'}});delete g.scope;return g as unknown as Peer;})();
 assert.deepEqual(peerUse(live),{usable:true});assert.equal(peerStatus(live),'registered');
 assert.deepEqual(peerUse(revoked),{usable:false,reason:'revoked'});assert.equal(peerStatus(revoked),'revoked');
 assert.deepEqual(peerUse(unset),{usable:false,reason:'scope_unset'});assert.equal(peerStatus(unset),'scope_unset');
 assert.deepEqual(peerUse(both),{usable:false,reason:'revoked'});
 assert.deepEqual(peerOperations(revoked),{read:false,send:false});assert.deepEqual(peerOperations(unset),{read:false,send:false});
 assert.equal(validPeers(roster(live,revoked,unset,both)),true);
 assert.equal(peerId(live),'grok-bot:chachamaru');
});
test('send is false by default and true only when the owner wrote true on a usable registration',()=>{
 const p=(over:Record<string,unknown>)=>good(over) as unknown as Peer;
 assert.deepEqual(peerOperations(p({})),{read:false,send:false});
 assert.deepEqual(peerOperations(p({operations:{}})),{read:false,send:false});
 assert.deepEqual(peerOperations(p({operations:{read:false}})),{read:false,send:false});
 assert.deepEqual(peerOperations(p({operations:{read:false,send:false}})),{read:false,send:false});
 assert.deepEqual(peerOperations(p({operations:{read:false,send:true}})),{read:false,send:true});
 assert.deepEqual(peerOperations(p({operations:{send:true},revoked:{at:'2026-10-01T00:00:00Z'}})),{read:false,send:false});
});
test('scope matches a listed folder or one inside it, never a sibling that shares a prefix, and resolves symlinks',async t=>{
 const base=await tmp(t),app=join(base,'app'),sub=join(app,'src'),sibling=join(base,'app2'),link=join(base,'link');
 for(const d of [app,sub,sibling])await mkdir(d,{recursive:true});await symlink(app,link);
 const p=(scope:unknown)=>good({scope}) as unknown as Peer;
 assert.equal(await scopeAllows(p([app]),app),true);assert.equal(await scopeAllows(p([app]),sub),true);
 assert.equal(await scopeAllows(p([app]),sibling),false);assert.equal(await scopeAllows(p([app]),base),false);
 assert.equal(await scopeAllows(p([link]),sub),true,'a symlinked scope root');assert.equal(await scopeAllows(p([app]),join(link,'src')),true,'a symlinked caller path');
 assert.equal(await scopeAllows(p([join(base,'gone')]),app),false);
 assert.equal(await scopeAllows(p('all'),sibling),true);
 const unset=good();delete unset.scope;assert.equal(await scopeAllows(unset as unknown as Peer,app),false);
 assert.equal(await scopeAllows(p([sibling,app]),sub),true,'any listed folder');
 // A workspace that cannot be resolved is refused, not matched on its spelling: ".." must not walk out of the scope.
 assert.equal(await scopeAllows(p([app]),join(app,'..','app2','nothere')),false,'.. into a sibling that does not exist');
 assert.equal(await scopeAllows(p([app]),join(app,'..','..','etc','x')),false,'.. out of the folder that does not exist');
 assert.equal(await scopeAllows(p([app]),join(app,'gone')),false,'a missing folder inside the scope');
 assert.equal(await scopeAllows(p([app]),join(app,'..','app2')),false,'.. into an existing sibling');
 assert.equal(await scopeAllows(p([app]),join(app,'src','..')),true,'.. that stays inside');
 assert.equal(await scopeAllows(p('all'),join(app,'gone')),true,'"all" does not look at the workspace');
});

async function autoFixture(t:Cleanup){
 const home=await tmp(t,'cldx-peers-auto-'),other=await tmp(t,'cldx-peers-other-');await mkdir(join(home,'.seamless'),{recursive:true,mode:0o700});
 const caller:Caller={provider:'codex',nativeId:'a',generation:'g',cwd:home,socket:'unused',source:'codex-turn-metadata'};
 const target:SessionIdentity={provider:'claude',nativeId:'b',generation:'g',cwd:home,socket:'unused'};
 const envelopes:Envelope[]=[],limitsPath=join(home,'limits.json'),peersPath=join(home,'.seamless','peers.json');
 const automatic=createAutomatic({home,limitsPath,caller:async()=>({status:'ok',caller}),scan:async()=>({sessions:[caller,{...target}],codexWorkspace:'observed'}),inspect:async()=>({...target}),scanOptions:{git:async cwd=>({state:'no_git',workspace:cwd})},adapter:{read:async()=>({status:'ok'}),inbound:async()=>envelopes,send:async()=>({status:'rejected'})}});
 return {home,other,caller,target,automatic,peersPath,limitsPath,write:(value:unknown,mode?:number)=>put(peersPath,value,mode)};
}
const SECRET_NAMES=['PEERTEST_ADDR','PEERTEST_SEND','PEERTEST_RECV'];
const secretPeer=(over:Record<string,unknown>={})=>good({addressEnv:SECRET_NAMES[0],sendKeyEnv:SECRET_NAMES[1],receiveKeyEnv:SECRET_NAMES[2],...over});

test('sessions lists registered outside executors apart from candidates, with read never offered',async t=>{
 const f=await autoFixture(t);
 await f.write(roster(secretPeer({operations:{read:false,send:true},scope:[f.home]}),secretPeer({name:'quiet-bot',displayName:'静かな Bot',addressEnv:'Q_A',sendKeyEnv:'Q_S',receiveKeyEnv:'Q_R',keyVersion:3,scope:'all'})));
 const r=await f.automatic('sessions',{});
 assert.equal(r.status,'ok');assert.deepEqual(r.candidates.map((c:any)=>c.id),['claude:b']);assert.equal(Object.hasOwn(r,'externalStatus'),false);
 assert.deepEqual(r.external,[
  {id:'grok-bot:chachamaru',product:'grok-bot',host:'external',displayName:'茶々丸',keyVersion:1,operations:{read:false,send:true},status:'registered',ticket:issueTicket({provider:'grok-bot',nativeId:'chachamaru',generation:'1',cwd:'',branch:null})},
  {id:'grok-bot:quiet-bot',product:'grok-bot',host:'external',displayName:'静かな Bot',keyVersion:3,operations:{read:false,send:false},status:'registered',ticket:null},
 ]);
 for(const e of r.external)assert.equal(e.operations.read,false);
});
test('a revoked registration in scope is listed as revoked with send false, even when the owner wrote send true',async t=>{
 const f=await autoFixture(t);
 await f.write(roster(secretPeer({operations:{send:true},revoked:{at:'2026-10-01T00:00:00Z'}})));
 assert.deepEqual((await f.automatic('sessions',{})).external,[{id:'grok-bot:chachamaru',product:'grok-bot',host:'external',displayName:'茶々丸',keyVersion:1,operations:{read:false,send:false},status:'revoked',ticket:null}]);
});
test('a workspace outside the registration scope does not see it; "all" is shown to anyone; an unset scope is never listed',async t=>{
 const f=await autoFixture(t),nested=join(f.home,'sub','deep');await mkdir(nested,{recursive:true});
 const unset=secretPeer({name:'unset-bot',addressEnv:'U_A',sendKeyEnv:'U_S',receiveKeyEnv:'U_R',operations:{send:true}});delete unset.scope;
 await f.write(roster(secretPeer({scope:[f.home]}),secretPeer({name:'everywhere',addressEnv:'E_A',sendKeyEnv:'E_S',receiveKeyEnv:'E_R',scope:'all'}),unset));
 const ids=async()=>(await f.automatic('sessions',{})).external.map((e:any)=>e.id);
 assert.deepEqual(await ids(),['grok-bot:chachamaru','grok-bot:everywhere']);
 f.caller.cwd=nested;assert.deepEqual(await ids(),['grok-bot:chachamaru','grok-bot:everywhere'],'a folder inside the scope');
 f.caller.cwd=f.other;assert.deepEqual(await ids(),['grok-bot:everywhere'],'a folder outside the scope');
 const r=await f.automatic('sessions',{});assert.equal(JSON.stringify(r).includes('unset-bot'),false,'an unset scope leaks no trace');
});
test('target narrows the outside list the same way it narrows candidates',async t=>{
 const f=await autoFixture(t);await f.write(roster(secretPeer(),secretPeer({name:'other-bot',addressEnv:'O_A',sendKeyEnv:'O_S',receiveKeyEnv:'O_R'})));
 const r=await f.automatic('sessions',{target:'grok-bot:other-bot'});assert.deepEqual(r.candidates,[]);assert.deepEqual(r.external.map((e:any)=>e.id),['grok-bot:other-bot']);
 assert.deepEqual((await f.automatic('sessions',{target:'claude:b'})).external,[]);
});
test('no roster means an empty external list; an unusable roster adds externalStatus unusable and still lists conversations',async t=>{
 const f=await autoFixture(t);
 const absent=await f.automatic('sessions',{});assert.deepEqual(absent.external,[]);assert.equal(Object.hasOwn(absent,'externalStatus'),false);assert.equal(absent.candidates.length,1);
 for(const [label,write] of [['broken JSON',()=>f.write('{nope')],['mode 0644',()=>f.write(roster(secretPeer()),0o644)],['read true',()=>f.write(roster(secretPeer({operations:{read:true,send:true}})))],['duplicate names',()=>f.write(roster(secretPeer(),secretPeer()))]] as const){
  await write();const r=await f.automatic('sessions',{});
  assert.equal(r.status,'ok',label);assert.deepEqual(r.external,[],label);assert.equal(r.externalStatus,'unusable',label);assert.equal(r.candidates.length,1,label);
 }
});
test('the roster is read afresh on every call: edits, a mode change and removal show at once',async t=>{
 const f=await autoFixture(t),ids=async()=>(await f.automatic('sessions',{})).external.map((e:any)=>e.id);
 await f.write(roster(secretPeer()));assert.deepEqual(await ids(),['grok-bot:chachamaru']);
 await f.write(roster(secretPeer(),secretPeer({name:'second',addressEnv:'B_A',sendKeyEnv:'B_S',receiveKeyEnv:'B_R'})));assert.deepEqual(await ids(),['grok-bot:chachamaru','grok-bot:second']);
 await f.write(roster(secretPeer({revoked:{at:'2026-10-09T00:00:00Z'}})));assert.equal((await f.automatic('sessions',{})).external[0].status,'revoked');
 await chmod(f.peersPath,0o644);assert.equal((await f.automatic('sessions',{})).externalStatus,'unusable');
 await rm(f.peersPath);assert.deepEqual(await f.automatic('sessions',{}).then(r=>[r.external,r.externalStatus]),[[],undefined]);
});
test('the owner limits still decide: operations.read false answers operation_not_permitted and shows no outside list',async t=>{
 const f=await autoFixture(t);await f.write(roster(secretPeer()));
 await writeLimits({...unrestricted,operations:{read:false,send:true}},null,f.limitsPath);
 const r=await f.automatic('sessions',{});assert.deepEqual(r,{status:'operation_not_permitted'});
});
test('the owner limits send:false also shows as send false for an outside executor, the same as for conversations',async t=>{
 const f=await autoFixture(t),send=async()=>{const r=await f.automatic('sessions',{});return [r.candidates[0].operations.send,r.external[0].operations.send];};
 await f.write(roster(secretPeer({operations:{send:true}})));
 assert.deepEqual(await send(),[true,true],'no limits file: the registration decides, the conversation default is open');
 await put(f.limitsPath,{...unrestricted,operations:{read:true,send:false}});
 assert.deepEqual(await send(),[false,false],'limits send:false closes both');
 await put(f.limitsPath,{...unrestricted,operations:{read:true,send:true}});
 assert.deepEqual(await send(),[true,true],'limits send:true leaves the registration in charge');
 await f.write(roster(secretPeer({operations:{send:false}})));
 assert.deepEqual(await send(),[true,false],'limits send:true never turns a registration send:false into true');
 await f.write(roster(secretPeer()));await rm(f.limitsPath);
 assert.deepEqual(await send(),[true,false],'no limits file never opens an outside executor');
});
test('the band response does not carry the outside list',async t=>{
 const f=await autoFixture(t);await f.write(roster(secretPeer()));
 const band=createAutomatic({home:f.home,caller:async()=>({status:'ok',caller:f.caller}),scan:async()=>{throw Error('band must never scan');},inspect:async()=>null,adapter:{read:async()=>null,send:async()=>({status:'rejected'}),received:async()=>[]}});
 const r=await band('band',{});assert.equal(r.status,'ok');assert.equal(Object.hasOwn(r,'external'),false);assert.equal(Object.hasOwn(r,'externalStatus'),false);assert.equal(JSON.stringify(r).includes('chachamaru'),false);
});
test('MCP and CLI-shaped calls carry the same outside list',async t=>{
 const f=await autoFixture(t);await f.write(roster(secretPeer({operations:{send:true}})));
 const handle=createMcp({automatic:f.automatic});
 await handle({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}});await handle({jsonrpc:'2.0',method:'notifications/initialized'});
 const reply:any=await handle({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'sessions',arguments:{}}});
 const viaMcp=JSON.parse(reply.result.content[0].text);
 assert.deepEqual(viaMcp.external,(await f.automatic('sessions',{peek:true})).external);assert.equal(viaMcp.external[0].operations.send,true);
});
test('sessions never creates or rewrites the roster',async t=>{
 const f=await autoFixture(t);await f.automatic('sessions',{});assert.equal(existsSync(f.peersPath),false);
 await f.write(roster(secretPeer()));const before=await stat(f.peersPath),bytes=await readFile(f.peersPath,'utf8');
 await f.automatic('sessions',{});await f.automatic('sessions',{});
 const after=await stat(f.peersPath);assert.equal(after.ino,before.ino);assert.equal(after.mtimeMs,before.mtimeMs);assert.equal(await readFile(f.peersPath,'utf8'),bytes);
});
test('the environment values behind the roster names are never read, listed or returned',async t=>{
 const f=await autoFixture(t),values=SECRET_NAMES.map(()=>`sv-${randomUUID()}`),real=process.env,touched=new Set<string>();
 await f.write(roster(secretPeer({operations:{send:true}})));
 SECRET_NAMES.forEach((n,i)=>{real[n]=values[i];});
 process.env=new Proxy(real,{
  get(target,key,receiver){if(typeof key==='string'&&SECRET_NAMES.includes(key))touched.add(key);return Reflect.get(target,key,receiver);},
  has(target,key){if(typeof key==='string'&&SECRET_NAMES.includes(key))touched.add(key);return Reflect.has(target,key);},
  getOwnPropertyDescriptor(target,key){if(typeof key==='string'&&SECRET_NAMES.includes(key))touched.add(key);return Reflect.getOwnPropertyDescriptor(target,key);},
 });
 let r:any,text='';
 try{r=await f.automatic('sessions',{});text=JSON.stringify(r);}
 finally{process.env=real;for(const n of SECRET_NAMES)delete real[n];}
 assert.equal(r.external.length,1);assert.deepEqual([...touched],[],'seamless must not touch the values while listing');
 for(const v of values)assert.equal(text.includes(v),false);for(const n of SECRET_NAMES)assert.equal(text.includes(n),false,'not even the variable names are returned');
 const code=readFileSync(new URL('../src/peers.ts',import.meta.url),'utf8').split('\n').filter(l=>!l.trimStart().startsWith('//')).join('\n');
 assert.equal(/process\.env|\benv\[|\benv\./.test(code),false,'peers.ts has no reference to the environment');
});
test('peerEnvSlots lists every registration, role and name, names only',()=>{
 const peers=[secretPeer(),secretPeer({name:'b',addressEnv:'B_A',sendKeyEnv:'B_S',receiveKeyEnv:'B_R'})] as unknown as Peer[];
 assert.deepEqual(peerEnvSlots({version:1,peers}),[
  {peer:'chachamaru',role:'addressEnv',env:'PEERTEST_ADDR'},{peer:'chachamaru',role:'sendKeyEnv',env:'PEERTEST_SEND'},{peer:'chachamaru',role:'receiveKeyEnv',env:'PEERTEST_RECV'},
  {peer:'b',role:'addressEnv',env:'B_A'},{peer:'b',role:'sendKeyEnv',env:'B_S'},{peer:'b',role:'receiveKeyEnv',env:'B_R'},
 ]);
});
test('externalPeers hides everything but names and numbers',async()=>{
 const read={status:'ok' as const,hash:'h',value:{version:1 as const,peers:[secretPeer({operations:{send:true}}) as unknown as Peer]}};
 const r=await externalPeers(read,'/anywhere');assert.deepEqual(Object.keys(r.external[0]).sort(),['displayName','host','id','keyVersion','operations','product','status','ticket']);
 assert.equal(r.external[0].ticket,null,'no ticket without someone who knows the limits to issue it');
});

// T2-6: scripts/peer-secrets.sh, called from scripts/verify.sh.
const script=fileURLToPath(new URL('../scripts/peer-secrets.sh',import.meta.url));
const repoRoot=fileURLToPath(new URL('..',import.meta.url));
// A fixture HOME hides the mise shim's configuration, so the real node's directory goes first, as the other spawned tests need.
const nodeDir=dirname(process.execPath);
const PLACES=['.seamless','repo','.claude/projects','.codex/sessions','.grok/sessions'] as const;
const KEY_ENV=['LEAKTEST_ADDR','LEAKTEST_SEND','LEAKTEST_RECV'] as const;
const ROLE={LEAKTEST_ADDR:'addressEnv',LEAKTEST_SEND:'sendKeyEnv',LEAKTEST_RECV:'receiveKeyEnv'} as const;
async function git(cwd:string,...args:string[]){execFileSync('git',['-c','user.name=t','-c','user.email=t@example.invalid','-c','commit.gpgsign=false',...args],{cwd,stdio:'pipe'});}
// SEAMLESS_PEER_SECRETS_FULL=1 also looks in the three products' conversation stores (the default looks in the repository and ~/.seamless).
const FULL={SEAMLESS_PEER_SECRETS_FULL:'1'};
const STORES=['.claude/projects','.codex/sessions','.grok/sessions'];
async function leak(t:Cleanup){
 const base=await tmp(t,'cldx-leak-'),home=join(base,'home'),repo=join(base,'repo');
 // The commands the script calls to reach the Keychain are stand-ins, first on PATH: a test never reaches the real Keychain.
 const fake=await fakeBin(base);
 for(const d of ['.seamless','.claude/projects/p','.codex/sessions/s','.grok/sessions/g'])await mkdir(join(home,d),{recursive:true});
 await mkdir(repo);execFileSync('git',['init','-q'],{cwd:repo});await writeFile(join(repo,'notes.txt'),'nothing secret here\n');
 await writeFile(join(home,'.claude/projects/p/a.jsonl'),'{"text":"hello"}\n');
 const values=Object.fromEntries(KEY_ENV.map(n=>[n,`lk-${n.slice(8,12).toLowerCase()}-${randomUUID()}`])) as Record<string,string>;
 const place=(p:string)=>p==='repo'?repo:join(home,p);
 const roster_=roster({...good({scope:'all'}),addressEnv:KEY_ENV[0],sendKeyEnv:KEY_ENV[1],receiveKeyEnv:KEY_ENV[2]});
 const run=(env:Record<string,string|undefined>={},opts:{cwd?:string;path?:string;args?:readonly string[]}={})=>{
  const r=spawnSync('bash',[...(opts.args??[]),script],{cwd:opts.cwd??repo,encoding:'utf8',env:{PATH:`${fake.bin}:${opts.path??`${nodeDir}:${process.env.PATH}`}`,HOME:home,...fake.env,...values,...env} as Record<string,string>});
  const out=r.stdout+r.stderr;
  for(const v of [...Object.values(values),...Object.values(env)])if(v&&v.length>=8)assert.equal(out.includes(v),false,'a value reached the output');
  for(const n of KEY_ENV)assert.equal(out.includes(n),false,'a variable name reached the output');
  return {status:r.status,out};
 };
 return {base,home,repo,values,place,fake,roster:roster_,run,writeRoster:(v:unknown=roster_,mode?:number)=>put(join(home,'.seamless','peers.json'),v,mode)};
}
const fails=(r:{status:number|null;out:string},role:string,label?:string)=>{assert.equal(r.status,1,label??r.out);assert.match(r.out,/peer-secrets: 失敗/,label);assert.match(r.out,new RegExp(`chachamaru の ${role}`),label);};
test('peer-secrets: no roster, or a roster without registrations, passes without doing anything',async t=>{
 const f=await leak(t);let r=f.run();assert.equal(r.status,0);assert.match(r.out,/^peer-secrets: ok/);
 await f.writeRoster(roster());r=f.run({LEAKTEST_SEND:''});assert.equal(r.status,0);assert.match(r.out,/^peer-secrets: ok/);
});
test('peer-secrets: with registrations whose values are set and stored nowhere, it passes; the default says which stores it did not look in, the full run does not',async t=>{
 const f=await leak(t);await f.writeRoster();
 let r=f.run(FULL);assert.equal(r.status,0,r.out);assert.match(r.out,/^peer-secrets: ok\n$/);
 r=f.run();assert.equal(r.status,0,r.out);assert.match(r.out,/^peer-secrets: ok\npeer-secrets: 注記（会話の保存先.*SEAMLESS_PEER_SECRETS_FULL=1 で照合する）\n$/);
});
for(const place of PLACES)test(`peer-secrets: a value written under ${place} fails and names the registration and role only${STORES.includes(place)?' (full run)':''}`,async t=>{
 const f=await leak(t);await f.writeRoster();
 const dir=f.place(place);await mkdir(dir,{recursive:true});await writeFile(join(dir,'record.log'),`line before\nsaved: ${f.values.LEAKTEST_SEND}\nline after\n`);
 const r=f.run(STORES.includes(place)?FULL:{});fails(r,'sendKeyEnv');assert.equal(/addressEnv|receiveKeyEnv/.test(r.out),false,'only the leaked slot is named');
});
// Why the default is narrow: once a registration exists the whole of the conversation stores is tens of gigabytes (about ten minutes), which
// made verify.sh unusable (specs/202610-more-peers evidence T2-1 and T2-6). The default is the repository (main checkout and worktree) and ~/.seamless.
for(const store of STORES)test(`peer-secrets: a value under ${store} is not looked for by default, and the pass says so; the full run finds it`,async t=>{
 const f=await leak(t);await f.writeRoster();
 await writeFile(join(f.home,store,store.startsWith('.claude')?'p':store.startsWith('.codex')?'s':'g','record.log'),`saved: ${f.values.LEAKTEST_SEND}\n`);
 let r=f.run();assert.equal(r.status,0,r.out);assert.match(r.out,/^peer-secrets: ok\npeer-secrets: 注記（会話の保存先/);
 r=f.run(FULL);fails(r,'sendKeyEnv');assert.match(r.out,new RegExp(store.replace('.','\\.')));
 // The default still looks in the repository and in ~/.seamless.
 await writeFile(join(f.repo,'leak.txt'),f.values.LEAKTEST_RECV);fails(f.run(),'receiveKeyEnv');
});
test('peer-secrets: the full run is on for 1 only; any other value is the default',async t=>{
 const f=await leak(t);await f.writeRoster();await writeFile(join(f.home,'.claude/projects/p/record.log'),`saved: ${f.values.LEAKTEST_SEND}\n`);
 for(const v of ['0','','true','yes','11'])assert.equal(f.run({SEAMLESS_PEER_SECRETS_FULL:v}).status,0,JSON.stringify(v));
 assert.equal(f.run({SEAMLESS_PEER_SECRETS_FULL:'1'}).status,1);
});
for(const name of KEY_ENV)test(`peer-secrets: a leaked ${name} is caught whichever of the three names it is`,async t=>{
 const f=await leak(t);await f.writeRoster();await writeFile(join(f.repo,'leak.txt'),`prefix-${f.values[name]}-suffix`);
 fails(f.run(),ROLE[name]);
});
for(const name of KEY_ENV)for(const how of ['unset','empty'])test(`peer-secrets: ${name} ${how} fails`,async t=>{
 const f=await leak(t);await f.writeRoster();
 // An undefined value in spawn's env is dropped, which is exactly "unset".
 const r=f.run({[name]:how==='empty'?'':undefined});fails(r,ROLE[name]);assert.match(r.out,/未設定または空/);
});
// A send key copied as "Bearer <key>" is sent as <key>, so <key> alone in a record is a leak too (2026-10-09 判定役の指摘 3).
test('peer-secrets: a send key set as "Bearer <key>" is caught when only <key> was stored',async t=>{
 const f=await leak(t);await f.writeRoster();const k=f.values.LEAKTEST_SEND;
 let r=f.run({LEAKTEST_SEND:'Bearer '+k});assert.equal(r.status,0,r.out);
 await writeFile(join(f.repo,'sent.log'),`authorization sent with ${k} once\n`);
 r=f.run({LEAKTEST_SEND:'Bearer '+k});fails(r,'sendKeyEnv');assert.ok(!r.out.includes(k),'the key itself is never printed');
});
test('peer-secrets: a value with a newline cannot be checked line by line, so it fails by registration and role',async t=>{
 const f=await leak(t);await f.writeRoster();const r=f.run({LEAKTEST_SEND:'first-line\n\nthird-line'});
 fails(r,'sendKeyEnv');assert.match(r.out,/改行/);
});
test('peer-secrets: an unusable roster fails (broken JSON, wrong mode, read true)',async t=>{
 const f=await leak(t);
 for(const [v,mode] of [['{nope',0o600],[f.roster,0o644],[roster({...f.roster.peers[0],operations:{read:true}}),0o600]] as const){
  await f.writeRoster(v,mode);const r=f.run();assert.equal(r.status,1,r.out);assert.match(r.out,/peer-secrets: 失敗/);
 }
});
test('peer-secrets: outside a git repository it fails instead of skipping the repository',async t=>{
 const f=await leak(t);await f.writeRoster();const r=f.run({},{cwd:f.base});assert.equal(r.status,1,r.out);assert.match(r.out,/peer-secrets: 失敗/);
});
test('peer-secrets: the values are never passed as arguments to any command',async t=>{
 const f=await leak(t);await f.writeRoster();
 const shims=join(f.base,'shims'),log=join(f.base,'argv.log');await mkdir(shims);
 const real=execFileSync('bash',['-c','command -v grep']).toString().trim();
 // A grep wrapper that records every argument, then runs the real grep with the same arguments and the same stdin.
 for(const name of ['grep']){await writeFile(join(shims,name),`#!/usr/bin/env bash\nprintf '<%s>\\n' "$@" >> '${log}'\nexec '${real}' "$@"\n`,{mode:0o755});await chmod(join(shims,name),0o755);}
 const path=`${shims}:${nodeDir}:${process.env.PATH}`;
 const ok=f.run({},{path});assert.equal(ok.status,0,ok.out);
 await writeFile(join(f.repo,'leak.txt'),f.values.LEAKTEST_RECV);
 const bad=f.run({},{path});assert.equal(bad.status,1,bad.out);
 const argv=readFileSync(log,'utf8');assert.ok(argv.includes('<-f>'),'the shim was used');
 for(const v of Object.values(f.values))assert.equal(argv.includes(v),false,'a value appeared in an argument list');
});

// Reading as bytes: under a UTF-8 locale grep skips a line that holds an invalid byte, so a value on that line used to pass.
for(const locale of ['en_US.UTF-8','ja_JP.UTF-8'])test(`peer-secrets: under ${locale} a value on a line with invalid UTF-8 bytes is still found`,async t=>{
 const f=await leak(t);await f.writeRoster();const utf8={LANG:locale,LC_ALL:locale},file=join(f.repo,'broken.log'),v=Buffer.from(f.values.LEAKTEST_SEND);
 assert.equal(f.run(utf8).status,0,'nothing stored yet');
 const scenes:Array<[string,Buffer]>=[
  ['bad bytes before and after on the same line',Buffer.concat([Buffer.from('before '),Buffer.from([0xff,0xfe]),Buffer.from(' bytes '),v,Buffer.from(' after\n')])],
  ['the value cut off by a multibyte lead right after it',Buffer.concat([v,Buffer.from([0xe3,0x81])])],
  ['a multibyte tail right before the value',Buffer.concat([Buffer.from([0xe3,0x81]),v])],
  ['NUL on both sides',Buffer.concat([Buffer.from([0]),v,Buffer.from([0])])],
 ];
 for(const [label,bytes] of scenes){await writeFile(file,bytes);fails(f.run(utf8),'sendKeyEnv',label);}
 const wide=`鍵-${randomUUID()}`;
 await writeFile(file,Buffer.concat([Buffer.from([0xff]),Buffer.from(`x ${wide} y`),Buffer.from([0xfe])]));
 fails(f.run({...utf8,LEAKTEST_SEND:wide}),'sendKeyEnv','a non-ASCII value next to invalid bytes');
});
// A storage place or a file inside it may be a symbolic link; BSD grep -r alone follows neither.
for(const place of ['.seamless',...STORES])test(`peer-secrets: ${place} as a symbolic link to a folder is still searched`,async t=>{
 const f=await leak(t),moved=join(f.base,'moved'),link=join(f.home,place),env=place==='.seamless'?{}:FULL;
 await mkdir(join(moved,'inner'),{recursive:true});await writeFile(join(moved,'inner','record.log'),`saved ${f.values.LEAKTEST_RECV}\n`);
 await rm(link,{recursive:true});await symlink(moved,link);await f.writeRoster();
 fails(f.run(env),'receiveKeyEnv');
 await rm(join(moved,'inner'),{recursive:true});assert.equal(f.run(env).status,0,'the same link with nothing stored passes');
});
test('peer-secrets: a symbolic link to a file inside a storage place is followed',async t=>{
 const f=await leak(t),outside=join(f.base,'outside');await mkdir(outside);await writeFile(join(outside,'secret.txt'),`x ${f.values.LEAKTEST_SEND} y`);
 await f.writeRoster();await symlink(join(outside,'secret.txt'),join(f.home,'.claude/projects/p/linked.txt'));
 fails(f.run(FULL),'sendKeyEnv');
});
test('peer-secrets: a symbolic link that goes nowhere fails instead of passing unchecked',async t=>{
 const f=await leak(t);await f.writeRoster();assert.equal(f.run(FULL).status,0);
 await symlink(join(f.base,'nowhere'),join(f.home,'.codex/sessions/s/dead'));
 assert.equal(f.run().status,0,'a store the default run does not look in is not looked at');
 let r=f.run(FULL);assert.equal(r.status,1,r.out);assert.match(r.out,/peer-secrets: 失敗/);
 await rm(join(f.home,'.codex/sessions/s/dead'));assert.equal(f.run(FULL).status,0);
 await rm(join(f.home,'.grok/sessions'),{recursive:true});await symlink(join(f.base,'nowhere'),join(f.home,'.grok/sessions'));
 assert.equal(f.run().status,0,'neither is a dead link in place of a store');
 r=f.run(FULL);assert.equal(r.status,1,r.out);assert.match(r.out,/\.grok\/sessions/);
 await rm(join(f.home,'.grok/sessions'));assert.equal(f.run(FULL).status,0,'a place that does not exist at all is simply skipped');
});
test('peer-secrets: a file that cannot be read fails instead of being skipped',async t=>{
 if(process.getuid?.()===0)return;
 const f=await leak(t);await f.writeRoster();const locked=join(f.repo,'locked.txt');await writeFile(locked,'nothing');await chmod(locked,0);
 const r=f.run();assert.equal(r.status,1,r.out);assert.match(r.out,/peer-secrets: 失敗/);
});

// Tracing from outside the script must not print a value.
test('peer-secrets: bash -x and SHELLOPTS=xtrace do not print a value',async t=>{
 const f=await leak(t);await f.writeRoster();
 for(const [label,env,opts] of [['bash -x',{},{args:['-x']}],['SHELLOPTS=xtrace',{SHELLOPTS:'xtrace'},{}]] as const){
  const r=f.run(env,opts);assert.equal(r.status,0,`${label}: ${r.out}`);assert.match(r.out,/^peer-secrets: ok/);
 }
 await writeFile(join(f.repo,'leak.txt'),f.values.LEAKTEST_ADDR);
 fails(f.run({SHELLOPTS:'xtrace'}),'addressEnv','a failing run traced from outside');
});

// A log written by a JSON encoder (JSON.stringify, serde_json) escapes \ " tab and CR; that spelling of a value is found too.
// Rarer encoders (PHP \/ , Go \u0026, Python \uXXXX) are not checked, because each spelling is another full pass; the pass says so.
test('peer-secrets: a value is also found as a JSON encoder writes it',async t=>{
 const f=await leak(t);await f.writeRoster();
 const v=`a"b\\c\td\re-${randomUUID()}`,json=JSON.stringify(v).slice(1,-1),file=join(f.repo,'log.jsonl');
 assert.notEqual(json,v);assert.equal(f.run({LEAKTEST_SEND:v}).status,0,'nothing stored yet');
 for(const [label,form] of Object.entries({raw:v,'JSON.stringify':json})){await writeFile(file,`{"type":"tool","text":"saved ${form} done"}\n`);fails(f.run({LEAKTEST_SEND:v}),'sendKeyEnv',label);}
 await writeFile(file,`{"text":"${json.slice(0,-8)}"}\n`);assert.equal(f.run({LEAKTEST_SEND:v}).status,0,'a part of the value is not the value');
});
test('peer-secrets: a pass names the spellings it did not check, only for values that have such characters',async t=>{
 const f=await leak(t);await f.writeRoster();
 let r=f.run(FULL);assert.match(r.out,/^peer-secrets: ok\n$/,'letters, digits and hyphens: nothing left unchecked');
 for(const v of [`https://example.invalid/hook?a=1&b=2-${randomUUID()}`,`a<b>-${randomUUID()}`,`鍵-${randomUUID()}`]){
  r=f.run({LEAKTEST_SEND:v});assert.equal(r.status,0,r.out);assert.match(r.out,/^peer-secrets: ok\n.*注記.*\\uXXXX.*\\\/.*\\u0026/s,v);
 }
});
test('peer-secrets: regex characters in a value are matched literally, and inside a longer run of letters',async t=>{
 const f=await leak(t);await f.writeRoster();const id=randomUUID(),file=join(f.repo,'x.txt');
 const dotted=`k.y*[z]\\${id}`;
 assert.equal(f.run({LEAKTEST_SEND:dotted}).status,0,'nothing stored yet');
 await writeFile(file,`kxy${id}\nkyyy${id}\n`);assert.equal(f.run({LEAKTEST_SEND:dotted}).status,0,'text a regex would match is not the value');
 await writeFile(file,`pre${dotted}post\n`);fails(f.run({LEAKTEST_SEND:dotted}),'sendKeyEnv','the literal value inside letters');
 const plain=`abc${id}`;await writeFile(file,`AAA${plain}BBB\n`);fails(f.run({LEAKTEST_SEND:plain}),'sendKeyEnv','a whole-word match would miss this');
});
test('peer-secrets: a secret pasted into a name field is never echoed',async t=>{
 const f=await leak(t),secretName=`F${randomBytes(31).toString('hex').toUpperCase()}`;
 await f.writeRoster(roster({...f.roster.peers[0],sendKeyEnv:secretName}));
 assert.equal(validPeers(roster({...f.roster.peers[0],sendKeyEnv:secretName})),true,'a hex key is a well-formed name');
 let r=f.run();fails(r,'sendKeyEnv');assert.equal(r.out.includes(secretName),false);
 await writeFile(join(f.repo,'leak.txt'),f.values.LEAKTEST_RECV);
 r=f.run({[secretName]:`v-${randomUUID()}`});fails(r,'receiveKeyEnv');assert.equal(r.out.includes(secretName),false);
});
test('peer-secrets: a variable name with a command in it is refused before it is expanded',async t=>{
 const f=await leak(t),fake=join(f.base,'fakenode'),marker=join(f.base,'INJECTED');await mkdir(fake);
 const fakeNode=async(line:string)=>{await writeFile(join(fake,'node'),`#!/bin/sh\nprintf '%s\\n' '${line}'\n`,{mode:0o755});await chmod(join(fake,'node'),0o755);};
 const path=`${fake}:${nodeDir}:${process.env.PATH}`;
 await fakeNode(`p\tsendKeyEnv\tA[$(touch ${marker})]`);
 let r=f.run({},{path});assert.equal(r.status,1,r.out);assert.match(r.out,/p の sendKeyEnv: 名前の形が不正/);assert.equal(existsSync(marker),false,'the command ran');
 await fakeNode(`p q\tsendKeyEnv\tA`);r=f.run({},{path});assert.equal(r.status,1,r.out);assert.match(r.out,/名簿の出力の形が不正/);
 await fakeNode(`p\tother\tA`);r=f.run({},{path});assert.equal(r.status,1,r.out);assert.match(r.out,/名簿の出力の形が不正/);
});
test('peer-secrets: from a linked worktree the main checkout is searched too',async t=>{
 const f=await leak(t);await f.writeRoster();await git(f.repo,'add','-A');await git(f.repo,'commit','-q','-m','first');
 const sibling=join(f.base,'sibling'),nested=join(f.repo,'.claude','worktrees','nested');
 await git(f.repo,'worktree','add','-q',sibling);await git(f.repo,'worktree','add','-q',nested);
 for(const [label,tree] of [['a worktree beside the main checkout',sibling],['a worktree inside the main checkout',nested]] as const){
  assert.equal(f.run({},{cwd:tree}).status,0,`${label}: clean`);
  await writeFile(join(f.repo,'main-only.txt'),`x ${f.values.LEAKTEST_SEND}`);
  let r=f.run({},{cwd:tree});fails(r,'sendKeyEnv',`${label}: stored in the main checkout`);assert.match(r.out,/リポジトリ（本線）/);
  await rm(join(f.repo,'main-only.txt'));
  await writeFile(join(tree,'tree-only.txt'),`x ${f.values.LEAKTEST_RECV}`);
  r=f.run({},{cwd:tree});fails(r,'receiveKeyEnv',`${label}: stored in the worktree`);
  await rm(join(tree,'tree-only.txt'));
 }
});

// verify.sh itself, run in a minimal copy of the repository: peer-secrets must be called, its failure must reach the exit
// code, and its pass must not erase an earlier failure. tsc and claude are stand-ins that exit with FAKE_TSC or FAKE_CLAUDE.
test('verify.sh runs peer-secrets, its failure fails verify, and its pass keeps an earlier failure',async t=>{
 const f=await leak(t);await f.writeRoster();const repo=f.repo,fakes=join(f.base,'fakebin');
 await mkdir(join(repo,'scripts'));await mkdir(join(repo,'tests'));await mkdir(join(repo,'mods','seamless-band'),{recursive:true});await mkdir(fakes);
 for(const name of ['verify.sh','peer-secrets.sh','peer-env-names.ts'])await copyFile(join(repoRoot,'scripts',name),join(repo,'scripts',name));
 await cp(join(repoRoot,'src'),join(repo,'src'),{recursive:true});await copyFile(join(repoRoot,'package.json'),join(repo,'package.json'));
 const passing="import test from 'node:test';\ntest('stand-in',()=>{});\n";
 await writeFile(join(repo,'tests','stand-in.test.ts'),passing);
 for(const [name,variable] of [['tsc','FAKE_TSC'],['claude','FAKE_CLAUDE']] as const){await writeFile(join(fakes,name),`#!/bin/sh\nexit "\${${variable}:-0}"\n`,{mode:0o755});await chmod(join(fakes,name),0o755);}
 const verify=(env:Record<string,string>={})=>{
  const r=spawnSync('bash',[join(repo,'scripts','verify.sh')],{cwd:f.base,encoding:'utf8',env:{PATH:`${fakes}:${f.fake.bin}:${nodeDir}:${process.env.PATH}`,HOME:f.home,...f.fake.env,...f.values,...env}});
  const out=r.stdout+r.stderr;for(const v of Object.values(f.values))assert.equal(out.includes(v),false,'a value reached the output');
  return {status:r.status,out};
 };
 let r=verify();assert.equal(r.status,0,r.out);assert.match(r.out,/peer-secrets: ok/);assert.match(r.out,/verify: exit=0/);
 r=verify({FAKE_TSC:'3'});assert.equal(r.status,3,r.out);assert.match(r.out,/peer-secrets: ok/,'peer-secrets still ran');
 r=verify({FAKE_CLAUDE:'4'});assert.equal(r.status,4,r.out);
 await writeFile(join(repo,'tests','stand-in.test.ts'),"import test from 'node:test';\ntest('stand-in',()=>{throw new Error('red');});\n");
 r=verify();assert.notEqual(r.status,0,r.out);assert.match(r.out,/peer-secrets: ok/);assert.doesNotMatch(r.out,/verify: exit=0/);
 await writeFile(join(repo,'tests','stand-in.test.ts'),passing);
 await writeFile(join(repo,'leak.txt'),`saved ${f.values.LEAKTEST_SEND}\n`);
 r=verify();assert.equal(r.status,1,r.out);assert.match(r.out,/peer-secrets: 失敗/);assert.match(r.out,/verify: exit=1/);
 r=verify({FAKE_TSC:'3'});assert.equal(r.status,1,'the later failure is the one reported, as in the other steps');
});
test('peer-secrets: the scripts avoid tracing and echoing',()=>{
 const verify=readFileSync(new URL('../scripts/verify.sh',import.meta.url),'utf8'),body=readFileSync(script,'utf8');
 assert.match(verify,/scripts\/peer-secrets\.sh/);assert.match(verify,/scripts\/\*\.ts/);
 const lines=body.split('\n').filter(l=>l.trim()!==''&&!l.trimStart().startsWith('#'));
 assert.equal(lines[0],'{ set +x; } 2>/dev/null','tracing is turned off before anything else');
 assert.ok(lines.includes('export LC_ALL=C'),'bytes, not characters');
 assert.equal(lines.some(l=>/set\s+-\S*x|xtrace/.test(l)),false);
 const start=lines.findIndex(l=>l.startsWith('emit() {')),end=lines.findIndex((l,i)=>i>start&&l==='}');
 assert.ok(start>=0&&end>start,'emit is the one place that prints a value');
 const outside=lines.filter((_,i)=>i<start||i>end);
 assert.equal(outside.some(l=>/\b(echo|printf)\b[^;|]*(\$v\b|\$\{v\}|\$\{!|\$x\b)/.test(l)),false,'no echo of a value');
 for(const l of lines.filter(l=>l.includes('${!')))assert.match(l,/^\s*(local )?v="\$\{!\w+:-\}"/,'an indirect value only goes into a variable');
 for(const l of lines.filter((l,i)=>/\bemit\b/.test(l)&&i!==start))assert.match(l,/\| scan /,'emit only feeds grep through a pipe');
});

// The values: the environment first, then the Keychain (generic password, service "seamless", account = the variable's name), as the
// program reads them (src/secrets.ts). The Keychain is a stand-in on PATH here (tests/support/fake-bin.ts).
const UNSET={LEAKTEST_ADDR:undefined,LEAKTEST_SEND:undefined,LEAKTEST_RECV:undefined};
const inKeychain=async(f:Awaited<ReturnType<typeof leak>>,names:readonly string[]=KEY_ENV)=>{for(const n of names)await f.fake.put(n,f.values[n]);};
test('peer-secrets: a value that is only in the Keychain is used, and a leak of it is found',async t=>{
 const f=await leak(t);await f.writeRoster();await inKeychain(f);
 let r=f.run(UNSET);assert.equal(r.status,0,r.out);assert.match(r.out,/^peer-secrets: ok/);
 for(const name of KEY_ENV){
  await writeFile(join(f.repo,'leak.txt'),`prefix ${f.values[name]} suffix`);
  fails(f.run(UNSET),ROLE[name],name);
 }
});
test('peer-secrets: the environment wins over the Keychain, and an empty environment value falls through to it',async t=>{
 const f=await leak(t);await f.writeRoster();
 const other=`kc-${randomUUID()}`;await f.fake.put('LEAKTEST_SEND',other);
 // The environment value is the one looked for; the Keychain one is not.
 await writeFile(join(f.repo,'leak.txt'),other);assert.equal(f.run().status,0,'the Keychain value is not the one in use');
 await writeFile(join(f.repo,'leak.txt'),f.values.LEAKTEST_SEND);fails(f.run(),'sendKeyEnv');
 // Empty in the environment: the Keychain value is the one in use.
 await writeFile(join(f.repo,'leak.txt'),other);fails(f.run({LEAKTEST_SEND:''}),'sendKeyEnv');
 const calls=await f.fake.calls();
 assert.ok(calls.length>0&&calls.every(c=>c==='security find-generic-password -s seamless -a LEAKTEST_SEND -w'),'only the one name the environment did not have was asked');
});
test('peer-secrets: nothing in the environment or the Keychain is a failure for that slot only',async t=>{
 const f=await leak(t);await f.writeRoster();await inKeychain(f,['LEAKTEST_ADDR','LEAKTEST_RECV']);
 const r=f.run({LEAKTEST_SEND:undefined});fails(r,'sendKeyEnv');assert.match(r.out,/未設定または空/);assert.equal(/addressEnv|receiveKeyEnv/.test(r.out),false);
});
test('peer-secrets: a Keychain that cannot be read (locked) is told apart from an item that is not there: the exit status is said, no value and no name is',async t=>{
 const f=await leak(t);await f.writeRoster();await inKeychain(f);
 const locked=f.run({...UNSET,FAKE_SECURITY_EXIT:'36'});fails(locked,'sendKeyEnv');
 assert.match(locked.out,/Keychain を読めなかった（終了 36）/);assert.equal(/未設定または空/.test(locked.out),false,'a Keychain that was not read is not "not set"');
 const absent=f.run({...UNSET,FAKE_SECURITY_EXIT:'44'});fails(absent,'sendKeyEnv');
 assert.match(absent.out,/未設定または空/,'status 44 is the item not being there');
});
test('peer-secrets: a Keychain that does not answer is given up on at the time limit and said so; the run ends and fails for that slot',async t=>{
 const f=await leak(t);await f.writeRoster();await inKeychain(f);
 const started=Date.now(),r=f.run({...UNSET,FAKE_SECURITY_SLOW:'1',SEAMLESS_SECURITY_TIMEOUT:'1'});
 assert.ok(Date.now()-started<20000,'each of the three lookups ended at its limit (a second), not when the stand-in finished (eight)');
 fails(r,'sendKeyEnv');assert.match(r.out,/1 秒以内に答えなかった/);assert.equal(/未設定または空/.test(r.out),false);
});
test('peer-secrets: a key stored in the Keychain as "Bearer <key>" is also looked for as <key>',async t=>{
 const f=await leak(t);await f.writeRoster();const k=f.values.LEAKTEST_SEND;await f.fake.put('LEAKTEST_SEND','Bearer '+k);
 assert.equal(f.run({LEAKTEST_SEND:undefined}).status,0);
 await writeFile(join(f.repo,'sent.log'),`authorization sent with ${k} once\n`);
 fails(f.run({LEAKTEST_SEND:undefined}),'sendKeyEnv');
});
test('peer-secrets: the Keychain is asked only for the names the environment does not have, with the name as the only variable argument, and no value is ever an argument',async t=>{
 const f=await leak(t);await f.writeRoster();await inKeychain(f,['LEAKTEST_ADDR','LEAKTEST_SEND']);
 const r=f.run({LEAKTEST_SEND:undefined,LEAKTEST_ADDR:''});assert.equal(r.status,0,r.out);
 const calls=await f.fake.calls();
 const asked=calls.filter(c=>c.startsWith('security')).sort();
 assert.deepEqual(asked,['security find-generic-password -s seamless -a LEAKTEST_ADDR -w','security find-generic-password -s seamless -a LEAKTEST_SEND -w']);
 for(const line of calls)for(const v of Object.values(f.values))assert.equal(line.includes(v),false,'a value appeared in an argument list');
});
test('peer-secrets: a Keychain value is not printed by bash -x, by SHELLOPTS=xtrace, or by a failing run',async t=>{
 const f=await leak(t);await f.writeRoster();await inKeychain(f);
 for(const [label,env,opts] of [['bash -x',UNSET,{args:['-x']}],['SHELLOPTS=xtrace',{...UNSET,SHELLOPTS:'xtrace'},{}]] as const){
  const r=f.run(env,opts);assert.equal(r.status,0,`${label}: ${r.out}`);assert.match(r.out,/^peer-secrets: ok/);
 }
 await writeFile(join(f.repo,'leak.txt'),f.values.LEAKTEST_SEND);
 fails(f.run({...UNSET,SHELLOPTS:'xtrace'}),'sendKeyEnv','a failing run traced from outside');
});
test('peer-secrets: a Keychain that fails (command missing, locked) is "not set", never a pass',async t=>{
 const f=await leak(t);await f.writeRoster();
 // No security command at all: the shim is removed from PATH by pointing PATH at a folder with only node and bash.
 const bare=join(f.base,'bare');await mkdir(bare);
 await symlink(process.execPath,join(bare,'node'));
 for(const tool of ['bash','git','grep','tr','cat','dirname','basename'])await symlink(execFileSync('bash',['-c',`command -v ${tool}`]).toString().trim(),join(bare,tool));
 const r=spawnSync(execFileSync('bash',['-c','command -v bash']).toString().trim(),[script],{cwd:f.repo,encoding:'utf8',env:{PATH:bare,HOME:f.home,...f.values,LEAKTEST_SEND:''} as Record<string,string>});
 assert.equal(r.status,1,r.stdout+r.stderr);assert.match(r.stdout,/chachamaru の sendKeyEnv/);
});
