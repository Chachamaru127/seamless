import {mkdir,writeFile,chmod,readFile} from 'node:fs/promises';
import {join} from 'node:path';

// Stand-ins for the macOS commands the shell scripts call (security, pbpaste, pbcopy, sleep), to be put first on PATH. A test never reaches the
// real Keychain or the real clipboard.
//  - security: a generic password is a file named after its account (service must be "seamless") in $FAKE_KEYCHAIN_DIR.
//    find-generic-password prints "keychain: ..." (never the value) and with -w prints the value and a line break; a missing item exits 44.
//    FAKE_SECURITY_EXIT=<n> makes every find-generic-password fail with that status (36: the Keychain is locked); FAKE_SECURITY_SLOW=1 makes it
//    never answer for 8 seconds (it is replaced by /bin/sleep, so the caller's time limit is what ends it).
//    add-generic-password stores the -w argument (and refuses an existing item without -U, as the real one does).
//  - pbpaste/pbcopy: the clipboard is the file $FAKE_CLIP_DIR/clip. $FAKE_CLIP_DIR/events holds "N<TAB>text" lines: at the Nth pbpaste call
//    the clipboard becomes that text, as if the person copied it then. Every pbcopy call is counted in $FAKE_CLIP_DIR/copies.
//  - sleep does nothing, so a two-minute wait is 120 quick polls.
// Every call is logged to $FAKE_BIN_LOG (one line, the command and its arguments) when that is set.
const SECURITY=`#!/bin/bash
[ -n "\${FAKE_BIN_LOG:-}" ] && printf 'security %s\\n' "$*" >> "$FAKE_BIN_LOG"
cmd="\${1:-}"; shift || true
service="" account="" value="" has_w=0 update=0
while [ $# -gt 0 ]; do
  case "$1" in
    -s) service="$2"; shift 2 ;;
    -a) account="$2"; shift 2 ;;
    -U) update=1; shift ;;
    -w) if [ "$cmd" = add-generic-password ]; then value="$2"; has_w=1; shift 2; else has_w=1; shift; fi ;;
    *) shift ;;
  esac
done
[ "$service" = seamless ] || { echo "fake security: unexpected service" >&2; exit 2; }
file="$FAKE_KEYCHAIN_DIR/$account"
case "$cmd" in
  find-generic-password)
    [ -n "\${FAKE_SECURITY_SLOW:-}" ] && exec /bin/sleep 8
    [ -n "\${FAKE_SECURITY_EXIT:-}" ] && { echo "security: User interaction is not allowed." >&2; exit "$FAKE_SECURITY_EXIT"; }
    [ -f "$file" ] || { echo "security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain." >&2; exit 44; }
    if [ "$has_w" = 1 ]; then cat "$file"; printf '\\n'; else echo 'keychain: "/fake/login.keychain-db"'; fi ;;
  add-generic-password)
    if [ -f "$file" ] && [ "$update" != 1 ]; then echo "security: SecKeychainItemCreateFromContent: The specified item already exists in the keychain." >&2; exit 45; fi
    [ "$has_w" = 1 ] || exit 3
    printf '%s' "$value" > "$file" ;;
  *) exit 1 ;;
esac
`;
const PBPASTE=`#!/bin/bash
[ -n "\${FAKE_BIN_LOG:-}" ] && printf 'pbpaste\\n' >> "$FAKE_BIN_LOG"
d="$FAKE_CLIP_DIR"
n=$(( $(cat "$d/n" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$d/n"
if [ -f "$d/events" ]; then
  while IFS=$'\\t' read -r at content; do
    if [ "$at" = "$n" ]; then printf '%s' "$content" > "$d/clip"; fi
  done < "$d/events"
fi
cat "$d/clip" 2>/dev/null || true
`;
const PBCOPY=`#!/bin/bash
[ -n "\${FAKE_BIN_LOG:-}" ] && printf 'pbcopy\\n' >> "$FAKE_BIN_LOG"
d="$FAKE_CLIP_DIR"
cat > "$d/clip"
echo x >> "$d/copies"
`;
const SLEEP=`#!/bin/bash
exit 0
`;
export async function fakeBin(base:string){
 const bin=join(base,'fake-commands'),keychain=join(base,'fake-keychain'),clip=join(base,'fake-clip'),log=join(base,'fake-bin.log');
 for(const d of [bin,keychain,clip])await mkdir(d,{recursive:true});
 for(const [name,body] of [['security',SECURITY],['pbpaste',PBPASTE],['pbcopy',PBCOPY],['sleep',SLEEP]] as const){await writeFile(join(bin,name),body,{mode:0o755});await chmod(join(bin,name),0o755);}
 await writeFile(log,'');
 return {
  bin,keychain,clip,log,
  // The environment variables the stand-ins read; put in front of a script's own environment.
  env:{FAKE_KEYCHAIN_DIR:keychain,FAKE_CLIP_DIR:clip,FAKE_BIN_LOG:log} as Record<string,string>,
  // Put a generic password in the fake Keychain, as `security add-generic-password -s seamless -a <name> -w <value>` would.
  put:(name:string,value:string)=>writeFile(join(keychain,name),value),
  get:(name:string)=>readFile(join(keychain,name),'utf8').catch(()=>null),
  // The clipboard now, and what the person will copy at which pbpaste call.
  setClipboard:(text:string)=>writeFile(join(clip,'clip'),text),
  copyAt:(events:Array<[number,string]>)=>writeFile(join(clip,'events'),events.map(([n,text])=>`${n}\t${text}`).join('\n')+'\n'),
  clipboard:()=>readFile(join(clip,'clip'),'utf8').catch(()=>''),
  copies:async()=>(await readFile(join(clip,'copies'),'utf8').catch(()=>'')).split('\n').filter(Boolean).length,
  calls:()=>readFile(log,'utf8').then(t=>t.split('\n').filter(Boolean)),
 };
}
