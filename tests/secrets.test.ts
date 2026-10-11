import test from 'node:test';
import assert from 'node:assert/strict';
import {secretReader,securityKeychain,noKeychain,runForStdout,SECURITY_PATH,KEYCHAIN_SERVICE,KEYCHAIN_TIMEOUT_MS} from '../src/secrets.ts';
import {fakeKeychain} from './support/keychain-fixture.ts';

// The one place the values behind a registration's variable names are read: the process environment first (a non-empty value),
// then the macOS Keychain (generic password, service "seamless", account = the variable's name). No test here reaches the real Keychain.
test('an environment value that is not empty wins, and the Keychain is not asked', async () => {
 const k = fakeKeychain({A: 'from-keychain'});
 const read = secretReader({A: 'from-env'}, k.read);
 assert.equal(await read('A'), 'from-env');
 assert.deepEqual(k.asked, []);
});
test('an unset or empty environment value falls through to the Keychain', async () => {
 const k = fakeKeychain({A: 'from-keychain', B: 'also-keychain'});
 const read = secretReader({B: ''}, k.read);
 assert.equal(await read('A'), 'from-keychain');
 assert.equal(await read('B'), 'also-keychain');
 assert.deepEqual(k.asked, ['A', 'B']);
});
test('neither place has it, or the Keychain reader fails: no value (never an exception)', async () => {
 const k = fakeKeychain();
 assert.equal(await secretReader({}, k.read)('A'), undefined);
 assert.equal(await secretReader({}, async () => { throw new Error('keychain exploded with sv-secret-text'); })('A'), undefined);
 assert.equal(await secretReader({}, async () => '')('A'), undefined);
 assert.equal(await secretReader({}, noKeychain)('A'), undefined);
});
test('a Keychain lookup is made once per name for the life of one reader; the environment is read afresh every time', async () => {
 const env: NodeJS.ProcessEnv = {};
 const k = fakeKeychain({A: 'kc-a'});
 const read = secretReader(env, k.read);
 assert.equal(await read('A'), 'kc-a');assert.equal(await read('A'), 'kc-a');assert.equal(await read('B'), undefined);assert.equal(await read('B'), undefined);
 assert.deepEqual(k.asked, ['A', 'B']);
 env.A = 'from-env-now';
 assert.equal(await read('A'), 'from-env-now');
 delete env.A;
 assert.equal(await read('A'), 'kc-a');
 // A new reader (the next call of the tool) looks again.
 await secretReader(env, k.read)('A');
 assert.deepEqual(k.asked, ['A', 'B', 'A']);
});
test('only the name that is asked for is looked at, in the environment and in the Keychain', async () => {
 const touched = new Set<string>();
 const env = new Proxy({A: 'a', B: 'b'} as NodeJS.ProcessEnv, {get(t, key, r) { if (typeof key === 'string') touched.add(key); return Reflect.get(t, key, r); }});
 const k = fakeKeychain({C: 'c'});
 const read = secretReader(env, k.read);
 await read('A'); await read('C');
 assert.deepEqual([...touched].sort(), ['A', 'C']);
 assert.deepEqual(k.asked, ['C']);
});

test('the security command: the fixed binary, service and account in the arguments, the value only from standard output, a time limit', async () => {
 const calls: Array<{file: string; args: string[]; timeoutMs: number}> = [];
 const reader = securityKeychain(async (file, args, timeoutMs) => { calls.push({file, args, timeoutMs}); return 'sv-value-1234\n'; });
 assert.equal(await reader('SEAMLESS_CHACHAMARU_SEND_KEY'), 'sv-value-1234');
 assert.deepEqual(calls, [{file: '/usr/bin/security', args: ['find-generic-password', '-s', 'seamless', '-a', 'SEAMLESS_CHACHAMARU_SEND_KEY', '-w'], timeoutMs: KEYCHAIN_TIMEOUT_MS}]);
 assert.equal(SECURITY_PATH, '/usr/bin/security');assert.equal(KEYCHAIN_SERVICE, 'seamless');
 assert.ok(KEYCHAIN_TIMEOUT_MS > 0 && KEYCHAIN_TIMEOUT_MS <= 10_000);
 assert.equal(calls[0].args.some(a => a.includes('sv-value')), false, 'the value was never an argument');
});
test('exactly one trailing line break is taken off the output; the rest of the value stays as it is', async () => {
 const one = (out: string) => securityKeychain(async () => out)('NAME');
 assert.equal(await one('abc\n'), 'abc');
 assert.equal(await one('abc'), 'abc');
 assert.equal(await one(' a b \n'), ' a b ');
 assert.equal(await one('abc\n\n'), 'abc\n');
 assert.equal(await one('\n'), null);
 assert.equal(await one(''), null);
});
test('a failed lookup (not found, locked, timed out, anything thrown) is "no value" and says nothing', async () => {
 const failing = securityKeychain(async () => { throw Object.assign(new Error('Command failed: security ... -a NAME -w'), {stdout: 'sv-leaky-stdout', stderr: 'sv-leaky-stderr'}); });
 assert.equal(await failing('NAME'), null);
});
test('a name that is not a variable name never reaches the command', async () => {
 let ran = 0;
 const reader = securityKeychain(async () => { ran++; return 'x\n'; });
 for (const bad of ['', '-w', 'a b', 'lower', 'A;B', 'A\nB', '1ABC', 'A'.repeat(129)]) assert.equal(await reader(bad), null, JSON.stringify(bad));
 assert.equal(ran, 0);
 assert.equal(await reader('A_1'), 'x');
});

// The default way of running it, shown with a harmless local command instead of the real binary.
test('runForStdout returns standard output, rejects on a failing exit or on the time limit, and closes standard input', async () => {
 assert.equal(await runForStdout(process.execPath, ['-e', 'process.stdout.write("sv-out\\n")'], 5000), 'sv-out\n');
 await assert.rejects(() => runForStdout(process.execPath, ['-e', 'process.stdout.write("sv-out-before-failing");process.exit(3)'], 5000), (e: Error) => !/sv-out-before-failing/.test(e.message));
 // A child that waits for standard input to end finishes, so the reader never hangs on an open pipe.
 assert.equal(await runForStdout(process.execPath, ['-e', 'process.stdin.on("end",()=>process.stdout.write("closed"));process.stdin.resume()'], 5000), 'closed');
 const started = Date.now();
 await assert.rejects(() => runForStdout(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], 200));
 assert.ok(Date.now() - started < 5000, 'the time limit stopped it');
 await assert.rejects(() => runForStdout('/nonexistent/binary-for-test', [], 1000));
});
