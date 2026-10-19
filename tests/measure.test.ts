import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {descendants,isSeamlessCli,parseProcessTable,seamlessProcesses} from '../scripts/measure.ts';

const exec=promisify(execFile);
const REPO=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const SCRIPT=join(REPO,'scripts','measure.ts');
const CLI=join(REPO,'src','cli.ts');

async function measure(args:string[],env?:NodeJS.ProcessEnv):Promise<{stdout:string;stderr:string;json:Record<string,unknown>}>{
 const {stdout,stderr}=await exec(process.execPath,[SCRIPT,...args],{maxBuffer:16*1024*1024,timeout:180000,env:env??process.env});
 const line=stdout.trim().split('\n').filter(Boolean).pop();
 assert.ok(line,`no JSON on stdout: ${stderr}`);
 return {stdout,stderr,json:JSON.parse(line) as Record<string,unknown>};
}

test('--help lists the five measurement subcommands',async()=>{
 const {stdout}=await exec(process.execPath,[SCRIPT,'--help']);
 for(const command of ['roundtrip','hold','batch','footprint','compare'])assert.ok(stdout.includes(command),command);
});

test('a fake roundtrip reports the request id and the matching reply id as JSON',async()=>{
 const {json}=await measure(['roundtrip','--fake']);
 assert.equal(json.status,'ok');assert.equal(json.command,'roundtrip');assert.equal(json.mode,'fake');
 assert.match(String(json.requestId),/^measure-/);
 assert.match(String(json.replyId),/^reply-/);
 assert.equal(json.match,true);
});

test('a fake hold reports held, but a fake peer has no observed product reason',async t=>{
 // A fake peer has no receiving settings and no IPC, so the reason must stay unknown_reason, not the product name.
 const home=await mkdtemp(join(tmpdir(),'seamless-measure-home-'));t.after(()=>rm(home,{recursive:true,force:true}));
 await mkdir(join(home,'.seamless'),{recursive:true});
 await writeFile(join(home,'.seamless','limits.json'),JSON.stringify({version:1,exclude:[],scope:null,operations:null,heldAfterSec:20})+'\n',{mode:0o600});
 const claude=await measure(['hold','--fake','--held-after-sec','1'],{...process.env,HOME:home});
 assert.equal(claude.json.status,'ok');assert.equal(claude.json.command,'hold');
 assert.equal(claude.json.state,'held');assert.equal(claude.json.reason,'unknown_reason');
 const codex=await measure(['hold','--target','fake:codex','--held-after-sec','1'],{...process.env,HOME:home});
 assert.equal(codex.json.state,'held');assert.equal(codex.json.reason,'unknown_reason');
 // A real home whose limits say 20s must not decide the fake stage: the injected value reaches the reader as well as the clock.
 const injected=await measure(['hold','--fake','--held-after-sec','1'],{...process.env,HOME:home});
 assert.equal(injected.json.state,'held');
});

test('batch --plan fake:2 writes a record file without the message body',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'seamless-measure-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=join(dir,'batch.jsonl'),body='MEASURE-BODY-MUST-NOT-BE-RECORDED-7f4c';
 const {json}=await measure(['batch','--plan','fake:2','--out',file,'--text',body]);
 assert.equal(json.status,'ok');assert.equal(json.command,'batch');assert.equal(json.entries,2);
 assert.equal(json.recordFile,file);
 const raw=await readFile(file,'utf8');
 assert.equal(raw.includes(body),false);
 const records=raw.trim().split('\n').map(line=>JSON.parse(line) as Record<string,unknown>);
 assert.equal(records.length,3);
 assert.deepEqual(records[0]!.mode,'fake');
 assert.equal(records.filter(r=>r.kind==='roundtrip').length,2);
 for(const record of records)assert.equal(JSON.stringify(record).includes('MEASURE-BODY'),false);
});

test('footprint targets node processes running this repository src/*.ts, wherever the option sits, and their children',()=>{
 const table=parseProcessTable([
  ` 101 1 node --enable-source-maps ${CLI} mcp`,
  ` 102 1 node ${join(REPO,'src','grok-hook.ts')}`,
  ` 103 1 curl https://x/seamless/`,
  ` 104 1 node /other/src/cli.ts send`,
  ` 105 101 node ${CLI} status`,
  ` 106 101 /usr/bin/helper --child`,
  ` 107 1 node ${join(REPO,'scripts','measure.ts')} footprint`,
  ` 108 1 node /other/viewer.js ${CLI}`,
  ` 109 1 node /other/viewer.js ${join(REPO,'src','grok-hook.ts')}`,
  ` 110 1 node ${CLI} ${join(REPO,'src','grok-hook.ts')}`,
 ].join('\n'));
 const matched=seamlessProcesses(table);
 assert.deepEqual(matched,[101,102,105,110]);
 const scoped=descendants(matched,table).filter(pid=>pid!==process.pid);
 assert.ok(scoped.includes(106));
 for(const unrelated of [103,104,107,108,109])assert.equal(scoped.includes(unrelated),false);
 assert.equal(isSeamlessCli(`node --enable-source-maps ${CLI} mcp`),true);
 assert.equal(isSeamlessCli(`node ${join(REPO,'src','grok-hook.ts')}`),true);
 assert.equal(isSeamlessCli(`python3 ${CLI}`),false);
 assert.equal(isSeamlessCli(`node /other/src/cli.ts`),false);
 // The script path is the first argument after the node options; later arguments are not inspected.
 assert.equal(isSeamlessCli(`node /other/viewer.js ${CLI}`),false);
 assert.equal(isSeamlessCli(`node --enable-source-maps /other/viewer.js ${CLI}`),false);
});

test('footprint reports the process count, the store and inbox bytes, and a scoped connection count',async()=>{
 const {json}=await measure(['footprint']);
 assert.equal(json.status,'ok');
 const summary=json.summary as {processes:number;bytes:{store:number;inbox:number};connections:number|null};
 assert.equal(typeof summary.processes,'number');
 assert.equal(typeof summary.bytes.store,'number');
 assert.equal(typeof summary.bytes.inbox,'number');
 assert.ok(summary.connections===null||typeof summary.connections==='number');
});

test('batch default record names include milliseconds and pid and never overwrite each other',async()=>{
 const first=await measure(['batch','--plan','fake:1']);
 const second=await measure(['batch','--plan','fake:1']);
 const firstFile=String(first.json.recordFile),secondFile=String(second.json.recordFile);
 try{
  assert.notEqual(firstFile,secondFile);
  assert.match(basename(firstFile),/^batch-\d{17}-\d+\.jsonl$/);
  assert.equal((await readFile(firstFile,'utf8')).trim().split('\n').length,2);
  assert.equal((await readFile(secondFile,'utf8')).trim().split('\n').length,2);
 }finally{
  await rm(firstFile,{force:true});await rm(secondFile,{force:true});
 }
});

test('compare --dry prints the five metrics as an empty table',async()=>{
 const {json,stdout}=await measure(['compare','--dry']);
 assert.equal(json.status,'ok');assert.equal(json.dry,true);
 const metrics=json.metrics as Array<{metric:string;value:null;samples:number}>;
 assert.deepEqual(metrics.map(m=>m.metric),['first_screen_seconds','first_roundtrip_seconds','operations','resume_success','display_accuracy']);
 assert.ok(metrics.every(m=>m.value===null&&m.samples===0));
 assert.ok(stdout.includes('指標'));
});
