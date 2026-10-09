// Prints the environment variable slots in ~/.seamless/peers.json, one per line as "registration<TAB>role<TAB>NAME".
// Never reads a value. Exit 1 when the roster exists but cannot be used; no output and exit 0 when it is absent or has no registration.
import {peerEnvSlots,readPeers} from '../src/peers.ts';
const read=await readPeers();
if(read.status==='unusable')process.exitCode=1;
else if(read.status==='ok')for(const slot of peerEnvSlots(read.value))console.log(`${slot.peer}\t${slot.role}\t${slot.env}`);
