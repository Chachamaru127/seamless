// Helper of scripts/peer-setup.sh: adds one registration to ~/.seamless/peers.json, or updates the one with the same name, and leaves the
// others as they are. Its arguments are names, a folder and numbers: never a key or an address.
//   check <name> <displayName|""> <scopeRoot|""> <addressEnv> <sendKeyEnv> <receiveKeyEnv> <rotate: 0|1>
//       exit 0 when the roster is usable and the registration would be valid; prints what the run will do to the row (before anything is asked)
//   put   <the same seven> <newKey: 0|1>     writes it; prints one line, "registered <name> <keyVersion> <scope>"
// An empty displayName or scopeRoot means "not given": an existing row keeps its own, a new row gets the defaults. A row that is set up
// again keeps what the owner decided (scope, operations, display name, key version; a row with no scope stays without one); only the three variable names are the standard
// ones, because the values are kept under them. A revoked row is never un-revoked by a plain rerun: only --rotate (a new receive key
// and a new key version) is the way back. The key version goes up whenever a new receive key was made for a row that already existed.
// The roster is written by no other part of seamless. It is read afterwards the way seamless reads it (src/peers.ts: a private file,
// no symbolic link, owner only), so a roster that command would not use is refused here too and never replaced.
import {lstat,mkdir,chmod,open,rename,unlink,stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {defaultPeersPath,readPeers,validPeers,peerOperations,type Peer,type PeerScope,type Peers} from '../src/peers.ts';

const fail=(message:string):never=>{process.stderr.write(`peer-roster-write: ${message}\n`);process.exit(1);};
const [command,name,displayArg,rootArg,addressEnv,sendKeyEnv,receiveKeyEnv,rotateArg,newKeyArg]=process.argv.slice(2);
const bit=(v:string|undefined)=>v==='0'||v==='1';
if(!['check','put'].includes(command)||[name,displayArg,rootArg,addressEnv,sendKeyEnv,receiveKeyEnv].some(v=>v===undefined)||!bit(rotateArg)||command==='put'&&!bit(newKeyArg))fail('arguments');
const path=defaultPeersPath(),dir=dirname(path),rotate=rotateArg==='1';
const scopeText=(scope:PeerScope|undefined)=>scope===undefined?'未設定':scope==='all'?'すべての場所':scope.join('、');

async function scopeRoot(root:string):Promise<string>{
 const normalized=resolve(root);
 const s=await stat(normalized).catch(()=>null);
 if(!s?.isDirectory())return fail('scope_not_a_folder');
 return normalized;
}
async function current():Promise<Peers>{
 // The folder first: a link or a stranger's folder is not a place for the roster.
 const d=await lstat(dir).catch(()=>null);
 if(d&&(!d.isDirectory()||d.isSymbolicLink()||d.uid!==process.getuid?.()))return fail('roster_folder_unusable');
 const read=await readPeers(path);
 if(read.status==='unusable')return fail('roster_unusable');
 return read.status==='ok'?read.value:{version:1,peers:[]};
}
async function next(roster:Peers):Promise<{roster:Peers;keyVersion:number;scope:PeerScope|undefined;plan:string[]}>{
 const old=roster.peers.find(p=>p.name===name);
 if(old?.revoked&&!rotate)return fail(`${name} は失効している。--rotate を付けると、新しい受信鍵と新しい keyVersion で失効を外す（付けない再実行は何も変えない）`);
 const displayName=displayArg!==''?displayArg:old?.displayName??'茶々丸';
 // A row without a scope (seamless refuses it) stays without one unless a folder is given: a rerun does not hand out a place to read from.
 // A new row reaches every place: a Bot or a Dot is not tied to one project folder (2026-10-12). A folder given narrows it.
 const scope:PeerScope|undefined=rootArg!==''?[await scopeRoot(rootArg)]:old!==undefined?old.scope:'all';
 const keyVersion=old===undefined?1:old.keyVersion+(command==='put'&&newKeyArg==='1'?1:0);
 const operations=old===undefined?{send:true}:old.operations;
 const peer:Peer={name,displayName,product:'grok-bot',addressEnv,sendKeyEnv,receiveKeyEnv,keyVersion,...(operations===undefined?{}:{operations}),...(scope===undefined?{}:{scope})};
 const peers=old===undefined?[...roster.peers,peer]:roster.peers.map(p=>p.name===name?peer:p);
 const made={version:1 as const,peers};
 if(!validPeers(made))return fail('registration_invalid');
 const canSend=peerOperations(peer).send;
 const plan=old===undefined
  ?[`登録: ${name}（新規）。範囲 ${scopeText(scope)}${rootArg===''?'（既定）':''}、送信 ${canSend?'可':'不可'}。この範囲の会話が ${displayName} から届く先になり、会話の文を ${displayName} へ送れる状態になる`]
  :[`登録: ${name}（既存の行を更新）`,
    scope===undefined?'範囲: 未設定（そのまま。この登録は使えない。使うには範囲のフォルダを渡す）':JSON.stringify(old.scope)===JSON.stringify(scope)?`範囲: ${scopeText(scope)}（そのまま）`:`範囲: ${scopeText(old.scope)} → ${scopeText(scope)}`,
    `送信: ${canSend?'可':'不可'}（名簿のまま。変えるなら名簿の operations を直す）`,
    ...(old.displayName!==displayName?[`表示名: ${old.displayName} → ${displayName}`]:[]),
    ...(old.revoked?['失効の印: 外す（--rotate）。受信鍵と keyVersion を新しくする']:[]),
    ...(old.addressEnv!==addressEnv||old.sendKeyEnv!==sendKeyEnv||old.receiveKeyEnv!==receiveKeyEnv?[`値の置き場: ${old.addressEnv}、${old.sendKeyEnv}、${old.receiveKeyEnv} → Keychain の標準の名前（${addressEnv}、${sendKeyEnv}、${receiveKeyEnv}）`]:[])];
 return {roster:made,keyVersion,scope,plan};
}
async function write(roster:Peers){
 await mkdir(dir,{recursive:true,mode:0o700});
 const d=await lstat(dir);
 if(!d.isDirectory()||d.isSymbolicLink()||d.uid!==process.getuid?.())return fail('roster_folder_unusable');
 if((d.mode&0o777)!==0o700)await chmod(dir,0o700);
 const tmp=`${path}.${randomUUID()}`;
 let handle;
 try{
  handle=await open(tmp,'wx',0o600);
  await handle.writeFile(JSON.stringify(roster,null,1)+'\n');
  await handle.sync();await handle.close();handle=undefined;
  await chmod(tmp,0o600);
  await rename(tmp,path);
 }finally{await handle?.close();await unlink(tmp).catch(()=>{});}
}
const {roster,keyVersion,scope,plan}=await next(await current());
if(command==='check')for(const line of plan)console.log(line);
else{
 await write(roster);
 // Read back the way seamless reads it.
 if((await readPeers(path)).status!=='ok')fail('roster_not_readable_after_write');
 console.log(`registered ${name} ${keyVersion} ${scopeText(scope)}`);
}
