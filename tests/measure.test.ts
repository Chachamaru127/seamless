import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {descendants,isSeamlessCli,parseProcessTable,seamlessProcesses} from '../scripts/measure.ts';

const exec=promisify(execFile);
const REPO=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const SCRIPT=join(REPO,'scripts','measure.ts');
const CLI=join(REPO,'src','cli.ts');

async function measure(args:string[]):Promise<{stdout:string;stderr:string;json:Record<string,unknown>}>{
 const {stdout,stderr}=await exec(process.execPath,[SCRIPT,...args],{maxBuffer:16*1024*1024,timeout:180000});
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

test('a fake hold reports held and the product reason, with the same wait in the reader',async()=>{
 const claude=await measure(['hold','--fake','--held-after-sec','1']);
 assert.equal(claude.json.status,'ok');assert.equal(claude.json.command,'hold');
 assert.equal(claude.json.state,'held');assert.equal(claude.json.reason,'claude_hold');
 const codex=await measure(['hold','--target','fake:codex','--held-after-sec','1']);
 assert.equal(codex.json.state,'held');assert.equal(codex.json.reason,'codex_goal');
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

test('footprint targets only node processes running this repository cli.ts, and their children',()=>{
 const table=parseProcessTable([
  ` 101 1 node ${CLI} send`,
  ` 102 1 node /some/other/repo/src/cli.ts send`,
  ` 103 1 curl https://example.com/seamless/src/cli.ts`,
  ` 104 101 node ${CLI} status`,
  ` 105 101 /usr/bin/helper --child`,
  ` 106 1 node ${join(REPO,'scripts','measure.ts')} footprint`,
 ].join('\n'));
 const matched=seamlessProcesses(table,CLI);
 assert.deepEqual(matched,[101,104]);
 const scoped=descendants(matched,table).filter(pid=>pid!==process.pid);
 assert.ok(scoped.includes(105));
 for(const unrelated of [102,103,106])assert.equal(scoped.includes(unrelated),false);
 assert.equal(isSeamlessCli(`node ${CLI} send`,CLI),true);
 assert.equal(isSeamlessCli(`node --enable-source-maps ${CLI} send`,CLI),false);
 assert.equal(isSeamlessCli(`python3 ${CLI}`,CLI),false);
});

test('compare --dry prints the five metrics as an empty table',async()=>{
 const {json,stdout}=await measure(['compare','--dry']);
 assert.equal(json.status,'ok');assert.equal(json.dry,true);
 const metrics=json.metrics as Array<{metric:string;value:null;samples:number}>;
 assert.deepEqual(metrics.map(m=>m.metric),['first_screen_seconds','first_roundtrip_seconds','operations','resume_success','display_accuracy']);
 assert.ok(metrics.every(m=>m.value===null&&m.samples===0));
 assert.ok(stdout.includes('指標'));
});
