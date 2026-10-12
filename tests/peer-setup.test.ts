import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,realpath,writeFile,readFile,mkdir,chmod,stat,readdir,rename} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readPeers,validPeers} from '../src/peers.ts';
import {fakeBin} from './support/fake-bin.ts';
import {peerRecord,secondRecord} from './support/signed-fixture.ts';

// scripts/peer-setup.sh: one run registers a Grok Bot (default: chachamaru). The Webhook URL and the Authorization header value are taken
// from the clipboard as the person copies them, kept in the Keychain, and the roster ~/.seamless/peers.json gets the registration. The commands
// that reach the Keychain and the clipboard are stand-ins on PATH (tests/support/fake-bin.ts); HOME is a temporary folder.
const script=fileURLToPath(new URL('../scripts/peer-setup.sh',import.meta.url));
const nodeDir=dirname(process.execPath);
type Cleanup={after:(fn:()=>Promise<void>)=>void};
const URL1='https://hooks.example.invalid/routine/abc123def456',URL2='https://hooks.example.invalid/routine/zzz999yyy888';
const KEY1='sk-test-0123456789abcdefghijklmnopqrstuvwx',KEY2='sk-test-ZYXWVUTSRQPONMLKJIHGFedcba9876543210';
// What the person copies, in the order the script asks: the URL, then the header value. pbpaste is called once to see the clipboard as it was, then once
// a second; the URL appears at the 3rd call, the clipboard is emptied by the script, and the header value appears at the 6th.
const COPIES:Array<[number,string]>=[[3,URL1],[6,`Bearer ${KEY1}`]];
async function setup(t:Cleanup,over:{scope?:boolean}={}){
 const base=await realpath(await mkdtemp(join(tmpdir(),'seamless-setup-')));t.after(()=>rm(base,{recursive:true,force:true}));
 const home=join(base,'home'),fake=await fakeBin(base),work=join(home,'LocalWork');
 await mkdir(home);if(over.scope!==false)await mkdir(work);
 await fake.setClipboard('copied earlier, nothing to do with this');await fake.copyAt(COPIES);
 const run=(args:string[]=[],env:Record<string,string|undefined>={},opts:{bashArgs?:readonly string[]}={})=>{
  const r=spawnSync('bash',[...(opts.bashArgs??[]),script,...args],{cwd:base,encoding:'utf8',timeout:60000,env:{PATH:`${fake.bin}:${nodeDir}:${process.env.PATH}`,HOME:home,...fake.env,...env} as Record<string,string>});
  return {status:r.status,out:r.stdout+r.stderr,stdout:r.stdout,stderr:r.stderr};
 };
 // A run starts counting clipboard reads again, with the clipboard as the person left it.
 const again=async(copies:Array<[number,string]>,clip='copied earlier, nothing to do with this')=>{await rm(join(fake.clip,'n'),{force:true});await fake.setClipboard(clip);await fake.copyAt(copies);};
 const peersPath=join(home,'.seamless','peers.json');
 const roster=async()=>JSON.parse(await readFile(peersPath,'utf8'));
 return {base,home,work,fake,run,again,peersPath,roster};
}
type S=Awaited<ReturnType<typeof setup>>;
// Every file under the home and the scripts' own folder, as text: nothing but the Keychain stand-in may hold a value.
async function everything(s:S){
 let out='';
 for(const dir of [s.home,s.fake.clip])for(const name of await readdir(dir,{recursive:true})){const p=join(dir,name);const st=await stat(p).catch(()=>null);if(st?.isFile()&&!p.endsWith('/clip/events')&&!p.endsWith('/events'))out+='\n'+await readFile(p,'latin1');}
 return out;
}
const noValue=(text:string,values:string[],label:string)=>{for(const v of values)assert.equal(text.includes(v),false,`${label}: a value was written or printed`);};

test('first run: the URL and the header value are kept in the Keychain, a receive key is made, the roster gets the registration, the clipboard ends empty and no value is printed',async t=>{
 const s=await setup(t);
 const r=s.run();assert.equal(r.status,0,r.out);
 assert.equal(await s.fake.get('SEAMLESS_CHACHAMARU_URL'),URL1);
 assert.equal(await s.fake.get('SEAMLESS_CHACHAMARU_SEND_KEY'),KEY1,'"Bearer " is taken off: the Keychain holds the key');
 const recv=await s.fake.get('SEAMLESS_CHACHAMARU_RECV_KEY');assert.match(recv??'',/^[0-9a-f]{64}$/);
 const roster=await s.roster();
 assert.deepEqual(roster,{version:1,peers:[{name:'chachamaru',displayName:'茶々丸',product:'grok-bot',addressEnv:'SEAMLESS_CHACHAMARU_URL',sendKeyEnv:'SEAMLESS_CHACHAMARU_SEND_KEY',receiveKeyEnv:'SEAMLESS_CHACHAMARU_RECV_KEY',keyVersion:1,operations:{send:true},scope:'all'}]},'a new Bot or Dot registration reaches every place: they work across projects (2026-10-12)');
 assert.equal(validPeers(roster),true);
 assert.match(r.stdout,/範囲 すべての場所（既定）/);
 const read=await readPeers(s.peersPath);assert.equal(read.status,'ok','the roster passes the same private-file check seamless itself makes');
 assert.equal((await stat(s.peersPath)).mode&0o777,0o600);assert.equal((await stat(dirname(s.peersPath))).mode&0o777,0o700);
 assert.equal(await s.fake.clipboard(),'');assert.equal(await s.fake.copies(),2,'emptied after the URL and after the header value');
 noValue(r.out,[URL1,KEY1,recv!,'abc123def456'],'output');
 noValue(await everything(s),[URL1,KEY1,recv!],'files');
 // Names and lengths are what it shows.
 assert.match(r.out,new RegExp(`SEAMLESS_CHACHAMARU_URL（${URL1.length} 文字）`));
 assert.match(r.out,new RegExp(`SEAMLESS_CHACHAMARU_SEND_KEY（${KEY1.length} 文字）`));
 assert.match(r.out,/受信鍵: 作った（SEAMLESS_CHACHAMARU_RECV_KEY、64 文字）/);
});
test('the header value may be the key alone as well as "Bearer <key>"; both are kept as the key',async t=>{
 const s=await setup(t);await s.fake.copyAt([[3,URL1],[6,KEY1]]);
 const r=s.run();assert.equal(r.status,0,r.out);assert.equal(await s.fake.get('SEAMLESS_CHACHAMARU_SEND_KEY'),KEY1);
});
test('what is already on the clipboard is not taken, and neither is a copy that is not an https address (first) or not a single visible token (second)',async t=>{
 const s=await setup(t);
 await s.fake.setClipboard(URL2);   // an https address already there: not "newly copied"
 await s.fake.copyAt([[3,'not an address'],[4,'http://insecure.example.invalid/x'],[5,'https://has space.example.invalid/x'],[6,URL1],[9,`Bearer two words`],[10,'Bearer '],[11,'https://hooks.example.invalid/routine/not-a-key'],[12,`Bearer ${KEY1}`]]);
 const r=s.run();assert.equal(r.status,0,r.out);
 assert.equal(await s.fake.get('SEAMLESS_CHACHAMARU_URL'),URL1);assert.equal(await s.fake.get('SEAMLESS_CHACHAMARU_SEND_KEY'),KEY1);
});
const STD={addressEnv:'SEAMLESS_CHACHAMARU_URL',sendKeyEnv:'SEAMLESS_CHACHAMARU_SEND_KEY',receiveKeyEnv:'SEAMLESS_CHACHAMARU_RECV_KEY'};
async function existing(s:S,row:Record<string,unknown>,...others:Array<Record<string,unknown>>){
 await mkdir(dirname(s.peersPath),{recursive:true,mode:0o700});
 await writeFile(s.peersPath,JSON.stringify({version:1,peers:[...others,row]}),{mode:0o600});
}
test('rerunning updates this registration only: the other registrations stay, a receive key that is there is not made again and the key version stays, and what the owner decided stays too',async t=>{
 const s=await setup(t);
 const other=secondRecord({scope:[s.work]});
 await existing(s,peerRecord({name:'chachamaru',displayName:'古い名前',addressEnv:'OLD_URL',sendKeyEnv:'OLD_SEND',receiveKeyEnv:'OLD_RECV',keyVersion:1,scope:'all'}),other);
 const first=s.run();assert.equal(first.status,0,first.out);
 const recv=await s.fake.get('SEAMLESS_CHACHAMARU_RECV_KEY');
 let roster=await s.roster();
 assert.deepEqual(roster.peers[0],other,'the other registration is untouched and keeps its place');
 assert.equal(roster.peers.length,2);const mine=roster.peers[1];
 assert.deepEqual(mine,{...peerRecord({name:'chachamaru',displayName:'古い名前',...STD,keyVersion:2,scope:'all'})},'the names of the Keychain items are the standard ones; the display name, the scope and the operations are the owner\'s, kept; the receive key was made new, so the version went up');
 // A second run, with a new address and a new header value copied.
 await s.again([[3,URL2],[6,`Bearer ${KEY2}`]]);
 const second=s.run();assert.equal(second.status,0,second.out);
 assert.equal(await s.fake.get('SEAMLESS_CHACHAMARU_URL'),URL2);assert.equal(await s.fake.get('SEAMLESS_CHACHAMARU_SEND_KEY'),KEY2);
 assert.equal(await s.fake.get('SEAMLESS_CHACHAMARU_RECV_KEY'),recv,'the receive key already there is kept');
 roster=await s.roster();assert.deepEqual(roster.peers,[other,mine]);
 assert.match(second.out,/受信鍵.*(既存|そのまま)/);
 noValue(second.out,[URL1,URL2,KEY1,KEY2,recv!],'output');noValue(await everything(s),[URL1,URL2,KEY1,KEY2,recv!],'files');
});
test('rerunning keeps a narrower scope, a refusal to send and a display name the owner wrote; an explicit folder replaces the scope and says so, before anything is asked',async t=>{
 const s=await setup(t);const narrow=join(s.work,'narrow'),elsewhere=join(s.base,'elsewhere');await mkdir(narrow);await mkdir(elsewhere);
 const row=peerRecord({name:'chachamaru',displayName:'わたしの茶々丸',...STD,keyVersion:2,operations:{read:false,send:false},scope:[narrow]});
 await existing(s,row);await s.fake.put('SEAMLESS_CHACHAMARU_RECV_KEY','a-receive-key-that-is-already-here');
 const r=s.run();assert.equal(r.status,0,r.out);
 assert.deepEqual((await s.roster()).peers,[row],'scope, operations, display name and key version are as the owner left them: nothing is widened by a rerun');
 assert.match(r.stdout,/送信[^\n]*不可/,'it is said that this registration may not send');assert.ok(r.stdout.includes(narrow));
 assert.ok(r.stdout.indexOf(narrow)<r.stdout.indexOf('Webhook URL をコピー'),'said before the first copy is asked for');
 // An explicit folder is the owner's new decision: the old and the new scope are both shown.
 await s.again(COPIES);
 const moved=s.run(['chachamaru','茶々丸',elsewhere]);assert.equal(moved.status,0,moved.out);
 const mine=(await s.roster()).peers[0];assert.deepEqual(mine.scope,[elsewhere]);assert.equal(mine.displayName,'茶々丸');assert.deepEqual(mine.operations,{read:false,send:false});
 assert.ok(moved.stdout.includes(narrow)&&moved.stdout.includes(elsewhere),'the scope that goes and the scope that comes are both shown');
 assert.ok(moved.stdout.indexOf(elsewhere)<moved.stdout.indexOf('Webhook URL をコピー'));
});
test('a registration with no scope (which seamless refuses) is not given one by a rerun that names no folder; a folder given sets it',async t=>{
 const s=await setup(t);
 const {scope:_,...row}=peerRecord({name:'chachamaru',...STD,keyVersion:1}) as Record<string,unknown>&{scope?:unknown};
 await existing(s,row);await s.fake.put('SEAMLESS_CHACHAMARU_RECV_KEY','a-receive-key-that-is-already-here');
 const r=s.run();assert.equal(r.status,0,r.out);
 assert.deepEqual((await s.roster()).peers,[row],'still no scope: the rerun did not widen anything');assert.match(r.stdout,/範囲: 未設定/);
 await s.again(COPIES);
 const set=s.run(['chachamaru','茶々丸',s.work]);assert.equal(set.status,0,set.out);assert.deepEqual((await s.roster()).peers[0].scope,[s.work]);
});
test('a revoked registration is not brought back by running the setup again: it is refused before anything is asked, and --rotate (a new receive key and a new version) is the way back',async t=>{
 const s=await setup(t);const oldKey='the-old-receive-key-0123456789abcdef';
 const row=peerRecord({name:'chachamaru',...STD,keyVersion:4,revoked:{at:'2026-10-01T00:00:00Z'},scope:[s.work]});
 await existing(s,row);await s.fake.put('SEAMLESS_CHACHAMARU_RECV_KEY',oldKey);
 const before=await readFile(s.peersPath,'utf8'),calls=(await s.fake.calls()).length;
 const refused=s.run();assert.equal(refused.status,1,refused.out);assert.match(refused.out,/失効/);assert.match(refused.out,/--rotate/);
 assert.equal((await s.fake.calls()).length,calls,'neither the Keychain nor the clipboard was reached');
 assert.equal(await readFile(s.peersPath,'utf8'),before,'the roster is as it was');assert.equal(await s.fake.get('SEAMLESS_CHACHAMARU_RECV_KEY'),oldKey);
 // Even with the receive key gone from the Keychain, a plain rerun does not lift a revocation.
 await rm(join(s.fake.keychain,'SEAMLESS_CHACHAMARU_RECV_KEY'));
 assert.equal(s.run().status,1);assert.equal(await readFile(s.peersPath,'utf8'),before);
 // --rotate: a new receive key, the version one higher, the mark gone, and it is said.
 await s.fake.put('SEAMLESS_CHACHAMARU_RECV_KEY',oldKey);
 const back=s.run(['--rotate']);assert.equal(back.status,0,back.out);
 const mine=(await s.roster()).peers[0];assert.equal(mine.revoked,undefined);assert.equal(mine.keyVersion,5);assert.deepEqual(mine.scope,[s.work]);
 const fresh=(await s.fake.get('SEAMLESS_CHACHAMARU_RECV_KEY'))!;assert.match(fresh,/^[0-9a-f]{64}$/);assert.notEqual(fresh,oldKey);
 assert.match(back.stdout,/失効[^\n]*(外す|解除)/,'lifting the revocation is said before anything is asked');
 noValue(back.out,[oldKey,fresh,URL1,KEY1],'output');
});
test('a receive key that is made again is a new key version: a row that is in the roster while its receive key is not in the Keychain gets the version raised, with or without --rotate',async t=>{
 const s=await setup(t);
 const row=peerRecord({name:'chachamaru',...STD,keyVersion:2,scope:[s.work]});
 await existing(s,row);
 const r=s.run();assert.equal(r.status,0,r.out);
 const key=await s.fake.get('SEAMLESS_CHACHAMARU_RECV_KEY');assert.match(key??'',/^[0-9a-f]{64}$/);
 assert.equal((await s.roster()).peers[0].keyVersion,3,'the old receive key is gone, so what was signed under version 2 cannot be checked any more');
 // The same with --rotate, on a row whose key was removed again.
 await rm(join(s.fake.keychain,'SEAMLESS_CHACHAMARU_RECV_KEY'));await s.again(COPIES);
 assert.equal(s.run(['--rotate']).status,0);assert.equal((await s.roster()).peers[0].keyVersion,4);
});
test('a copy that only looks like an address or a key is refused: no host, a user part, a one-word header, a short header; the host of the address that is kept is shown, and nothing else of it',async t=>{
 const s=await setup(t);
 await s.fake.copyAt([[3,'https://'],[4,'https://user@evil.example.invalid/x'],[5,'https:///no-host/x'],[6,'https://bad host.example.invalid/x'],[7,URL1],[10,'Bearer'],[11,'short'],[12,'Bearer sk-1234567'],[13,`Bearer ${KEY1}`]]);
 const r=s.run();assert.equal(r.status,0,r.out);
 assert.equal(await s.fake.get('SEAMLESS_CHACHAMARU_URL'),URL1);assert.equal(await s.fake.get('SEAMLESS_CHACHAMARU_SEND_KEY'),KEY1);
 assert.match(r.stdout,/hooks\.example\.invalid/,'the host is shown, so a wrong address can be noticed');
 noValue(r.out,['abc123def456',URL1,KEY1],'output');
 assert.match(r.stdout,/形が合わない/,'a copy that was passed over is said once, without showing it');
 noValue(r.out,['evil.example.invalid'],'a refused copy is not shown');
});
test('after the wait the failure says what to do when the same text was already on the clipboard',async t=>{
 const s=await setup(t);await s.fake.copyAt([[3,'not an address']]);
 const r=s.run();assert.equal(r.status,1,r.out);assert.match(r.out,/別の文字列/);
});
test('--rotate makes a new receive key and raises the key version by one each time; the other registrations stay',async t=>{
 const s=await setup(t);
 await mkdir(dirname(s.peersPath),{mode:0o700});await writeFile(s.peersPath,JSON.stringify({version:1,peers:[secondRecord({scope:[s.work]})]}),{mode:0o600});
 assert.equal(s.run().status,0);const key1=(await s.fake.get('SEAMLESS_CHACHAMARU_RECV_KEY'))!;
 assert.equal((await s.roster()).peers[1].keyVersion,1);
 await s.again([[3,URL2],[6,`Bearer ${KEY2}`]]);
 const r=s.run(['--rotate']);assert.equal(r.status,0,r.out);
 const key2=(await s.fake.get('SEAMLESS_CHACHAMARU_RECV_KEY'))!;assert.match(key2,/^[0-9a-f]{64}$/);assert.notEqual(key2,key1);
 let roster=await s.roster();assert.equal(roster.peers[1].keyVersion,2);assert.deepEqual(roster.peers[0],secondRecord({scope:[s.work]}));
 noValue(r.out,[key1,key2],'output');
 await s.again([[3,URL1],[6,`Bearer ${KEY1}`]]);
 assert.equal(s.run(['--rotate']).status,0);roster=await s.roster();assert.equal(roster.peers[1].keyVersion,3);
 assert.notEqual(await s.fake.get('SEAMLESS_CHACHAMARU_RECV_KEY'),key2);
 // Not rotating again keeps what is there.
 const kept=await s.fake.get('SEAMLESS_CHACHAMARU_RECV_KEY');await s.again([[3,URL1],[6,`Bearer ${KEY1}`]]);
 assert.equal(s.run().status,0);assert.equal(await s.fake.get('SEAMLESS_CHACHAMARU_RECV_KEY'),kept);assert.equal((await s.roster()).peers[1].keyVersion,3);
});
test('--rotate on a registration that has no receive key yet only makes one: nothing was replaced, so the version stays',async t=>{
 const s=await setup(t);const r=s.run(['--rotate']);assert.equal(r.status,0,r.out);
 assert.equal((await s.roster()).peers[0].keyVersion,1);assert.match((await s.fake.get('SEAMLESS_CHACHAMARU_RECV_KEY'))??'',/^[0-9a-f]{64}$/);
});
test('other names, display names and folders: the environment names follow the registration name, the scope is the folder given',async t=>{
 const s=await setup(t);const folder=join(s.base,'projects');await mkdir(folder);
 const r=s.run(['my-bot','マイ ボット',folder]);assert.equal(r.status,0,r.out);
 const peer=(await s.roster()).peers[0];
 assert.deepEqual(peer,{name:'my-bot',displayName:'マイ ボット',product:'grok-bot',addressEnv:'SEAMLESS_MY_BOT_URL',sendKeyEnv:'SEAMLESS_MY_BOT_SEND_KEY',receiveKeyEnv:'SEAMLESS_MY_BOT_RECV_KEY',keyVersion:1,operations:{send:true},scope:[folder]});
 assert.equal(await s.fake.get('SEAMLESS_MY_BOT_URL'),URL1);assert.equal(await s.fake.get('SEAMLESS_CHACHAMARU_URL'),null);
 // A folder spelled with a trailing slash or a dot segment is stored in the form the roster accepts.
 await s.again(COPIES);assert.equal(s.run(['my-bot','マイ ボット',`${folder}/./`]).status,0);assert.deepEqual((await s.roster()).peers[0].scope,[folder]);
});
test('a copy that never comes is a failure after the wait: nothing is kept, the roster is not made, and the clipboard is left as the person has it',async t=>{
 const s=await setup(t);await s.fake.copyAt([[3,'not an address']]);
 const r=s.run();assert.equal(r.status,1,r.out);assert.match(r.out,/2 分/);
 assert.equal(await s.fake.get('SEAMLESS_CHACHAMARU_URL'),null);assert.equal(await s.fake.get('SEAMLESS_CHACHAMARU_RECV_KEY'),null);
 assert.equal(await stat(s.peersPath).then(()=>true,()=>false),false);assert.equal(await s.fake.copies(),0);
 // The address came but the header value did not: the address is kept (a rerun asks for both again), but there is no registration.
 await s.again([[3,URL1]]);const r2=s.run();assert.equal(r2.status,1,r2.out);
 assert.equal(await s.fake.get('SEAMLESS_CHACHAMARU_RECV_KEY'),null,'no receive key is made before both values are in');
 assert.equal(await stat(s.peersPath).then(()=>true,()=>false),false);noValue(r2.out,[URL1],'output');
});
test('arguments and the roster are checked before anything is asked for: a bad name, too many arguments, a folder that is not there, a roster that cannot be used',async t=>{
 const s=await setup(t);const untouched=async(label:string)=>{assert.equal(await s.fake.get('SEAMLESS_CHACHAMARU_URL'),null,label);assert.equal((await s.fake.calls()).length,0,`${label}: neither the Keychain nor the clipboard was reached`);};
 for(const [label,args] of [['upper case',['Bad']],['space',['a b']],['empty name',['']],['too long',['a'.repeat(64)]],['four arguments',['a','b','/tmp','x']],['unknown option',['--nope']],['a folder that does not exist',['chachamaru','茶々丸',join(s.base,'nowhere')]],['a file as the folder',['chachamaru','茶々丸',script]],['display name too long',['chachamaru','x'.repeat(65)]],['empty display name',['chachamaru','']]] as const){
  const r=s.run([...args]);assert.notEqual(r.status,0,`${label}: ${r.out}`);await untouched(label);
  if(label==='unknown option'){assert.match(r.out,/新規は 茶々丸 と すべての場所/,'the usage says what a new registration gets');assert.doesNotMatch(r.out,/LocalWork/);}
 }
 await mkdir(dirname(s.peersPath),{mode:0o700});
 for(const [label,write] of [['broken JSON',()=>writeFile(s.peersPath,'{nope',{mode:0o600})],['not private',async()=>{await writeFile(s.peersPath,JSON.stringify({version:1,peers:[]}),{mode:0o644});await chmod(s.peersPath,0o644);}]] as const){
  await rm(s.peersPath,{force:true});await write();const before=await readFile(s.peersPath,'utf8');
  const r=s.run();assert.equal(r.status,1,`${label}: ${r.out}`);assert.match(r.out,/名簿/);await untouched(label);assert.equal(await readFile(s.peersPath,'utf8'),before,`${label}: the roster was not touched`);
 }
});
test('a registration whose environment names would clash with another registration\'s is refused before anything is asked for',async t=>{
 const s=await setup(t);await mkdir(dirname(s.peersPath),{mode:0o700});
 await writeFile(s.peersPath,JSON.stringify({version:1,peers:[secondRecord({name:'other',scope:[s.work],addressEnv:'SEAMLESS_CHACHAMARU_URL'})]}),{mode:0o600});
 const r=s.run();assert.equal(r.status,1,r.out);assert.equal((await s.fake.calls()).length,0);
});
test('the folder ~/.seamless is made private (0700) even when it was there with wider rights; the roster file is 0600',async t=>{
 const s=await setup(t);await mkdir(dirname(s.peersPath),{mode:0o755});await chmod(dirname(s.peersPath),0o755);
 assert.equal(s.run().status,0);assert.equal((await stat(dirname(s.peersPath))).mode&0o777,0o700);assert.equal((await stat(s.peersPath)).mode&0o777,0o600);
 assert.deepEqual((await readdir(dirname(s.peersPath))).filter(n=>n!=='peers.json'),[],'no temporary file is left behind');
});
test('a symbolic link in place of ~/.seamless or of the roster file is refused',async t=>{
 const s=await setup(t);const real=join(s.base,'real');await mkdir(real,{mode:0o700});
 const {symlink}=await import('node:fs/promises');
 await symlink(real,join(s.home,'.seamless'));
 const r=s.run();assert.equal(r.status,1,r.out);assert.equal(await s.fake.get('SEAMLESS_CHACHAMARU_URL'),null);assert.deepEqual(await readdir(real),[]);
 // A real folder with the roster itself a link to a private file.
 await rm(join(s.home,'.seamless'));await mkdir(join(s.home,'.seamless'),{mode:0o700});
 const file=join(s.base,'elsewhere.json');await writeFile(file,JSON.stringify({version:1,peers:[]}),{mode:0o600});await symlink(file,s.peersPath);
 const r2=s.run();assert.equal(r2.status,1,r2.out);assert.equal(await s.fake.get('SEAMLESS_CHACHAMARU_URL'),null);assert.equal(await readFile(file,'utf8'),JSON.stringify({version:1,peers:[]}));
});
test('no value reaches the output or a file under bash -x, under SHELLOPTS=xtrace or on a failing run; the secrets are never arguments of anything but the Keychain write',async t=>{
 for(const [label,env,opts] of [['bash -x',{},{bashArgs:['-x']}],['SHELLOPTS=xtrace',{SHELLOPTS:'xtrace'},{}]] as const){
  const s=await setup(t);const r=s.run([],env,opts);assert.equal(r.status,0,`${label}: ${r.out}`);
  const recv=(await s.fake.get('SEAMLESS_CHACHAMARU_RECV_KEY'))!;
  noValue(r.out,[URL1,KEY1,recv],label);noValue(await everything(s),[URL1,KEY1,recv],label);
  // Only `security add-generic-password` has a value among its arguments (the Keychain write); pbpaste, pbcopy and the reads take none.
  for(const line of await s.fake.calls())if(!line.startsWith('security add-generic-password '))noValue(line,[URL1,KEY1,recv],`${label}: ${line}`);
 }
 const s=await setup(t);await s.fake.copyAt([[3,URL1]]);const r=s.run([],{SHELLOPTS:'xtrace'});assert.equal(r.status,1);noValue(r.out,[URL1],'a failing run');
});
test('the script turns tracing off first, never echoes a value, and only the Keychain write has one in an argument list',()=>{
 const body=readFileSync(script,'utf8'),lines=body.split('\n').filter(l=>l.trim()!==''&&!l.trimStart().startsWith('#'));
 assert.equal(lines[0],'{ set +x; } 2>/dev/null','tracing is turned off before anything else');
 assert.equal(lines.some(l=>/set\s+-\S*x|xtrace/.test(l)),false);
 assert.equal(lines.some(l=>/\b(echo|printf)\b[^;|]*\$\{?(url|key|got|header|recv|send)\b/.test(l)&&!/\$\{#/.test(l)),false,'no echo of a value');
 for(const l of lines.filter(l=>l.includes('-w ')))assert.match(l,/security (add|find)-generic-password/,'-w only on the Keychain commands');
});
