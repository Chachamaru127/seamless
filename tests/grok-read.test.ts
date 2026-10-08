import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createReader} from '../src/adapters/read.ts';
import {createGrokReader} from '../src/adapters/grok.ts';
import type {Registration} from '../src/protocol.ts';
import {grokHome,ids,OPENED} from './support/grok-fixture.ts';
const target=(work:string,generation='501@'+OPENED):Registration=>({id:'grok:'+ids.live,provider:'grok',nativeId:ids.live,generation,host:'local',displayName:'grok',workspace:work,operations:['read'],grants:[]});
async function setup(t:Parameters<typeof grokHome>[0]){
 const f=await grokHome(t),dir=join(f.home,'.grok','sessions',encodeURIComponent(f.work),ids.live);
 await copyFile(new URL('./fixtures/grok-updates.jsonl',import.meta.url),join(dir,'updates.jsonl'));
 // The raw model history sits beside the updates and must never be read.
 await writeFile(join(dir,'chat_history.jsonl'),JSON.stringify({type:'user',content:[{type:'text',text:'SECRET-HISTORY'}]})+'\n');
 return {f,read:createReader({grok:createGrokReader({home:f.home,...f.grok})})};
}
test('Grok read returns the visible conversation only: one user item, two agent items, one tool call, in order',async t=>{
 const {f,read}=await setup(t);const result:any=await read(target(f.work),{limit:100});
 assert.equal(result.status,'ok');
 assert.deepEqual(result.items.map((x:any)=>[x.role,x.text]),[['user','lsof の回数を数えて'],['assistant','数えます。結果は 3 回です。'],['assistant','追記を読みました。'],['tool','run_terminal_command']]);
 assert.equal(result.source,'grok-updates');assert.equal(result.target.generation,'501@'+OPENED);
 const all=JSON.stringify(result);
 for(const secret of ['SECRET-THOUGHT','SECRET-INPUT','SECRET-OUTPUT','SECRET-HISTORY','OTHER-SESSION'])assert.ok(!all.includes(secret),secret);
});
test('Grok read of another generation of the same conversation is refused',async t=>{
 const {f,read}=await setup(t);
 assert.equal(((await read(target(f.work,'999@'+OPENED),{})) as any).status,'generation_mismatch');
});
test('Grok read of a conversation that is not running is not found',async t=>{
 const {f,read}=await setup(t);await f.ledger([]);
 assert.equal(((await read(target(f.work),{})) as any).status,'not_found');
});
