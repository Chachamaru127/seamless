import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
test('peer instructions preserve settings and approvals; normal and failed paths leak no private markers',async()=>{
 let output='',ok=false;
 try{const r=await run(process.execPath,['tests/support/privacy-fixture.ts']);output=r.stdout+r.stderr;ok=true;}catch(e){const r=e as {stdout?:string;stderr?:string};output=(r.stdout??'')+(r.stderr??'');}
 // Assert booleans so even a regression never echoes private output into TAP evidence.
 assert.equal(['BODY_PRIVATE_7','THOUGHT_PRIVATE_7','AUTH_PRIVATE_7'].some(m=>output.includes(m)),false,'private marker in child output');
 assert.equal(ok,true,'privacy fixture failed');assert.equal(output.includes('privacy passed'),true);
 assert.equal(output.includes('request_failed'),true);
});
