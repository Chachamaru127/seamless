import { Registry, loadRegistry } from '../../src/registry.ts';
import { createServe } from '../../src/serve.ts';
import { runLines } from '../../src/io.ts';
const args=process.argv.slice(2);
const path=args[args.indexOf('--registry')+1],caller=args[args.indexOf('--caller')+1];
try {
 const registry=new Registry(await loadRegistry(path),async r=>({nativeId:r.nativeId,generation:r.generation,status:'online',observedAt:Date.now(),contextObservedAt:Date.now(),source:'test-fixture',cwd:'/w',context:{state:'git',workspace:'/w',worktree:'/w',repository:'/repo',headState:'attached',branch:'refs/heads/main',head:'abc',dirty:false}}));
 await runLines(createServe({registry,caller,refresh:async()=>registry.replace(await loadRegistry(path))}));
} catch { process.stderr.write('bootstrap_invalid\n');process.exitCode=1; }
