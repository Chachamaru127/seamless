import type {KeychainReader} from '../../src/secrets.ts';

// A stand-in for the macOS Keychain: a plain object, injected where the real reader would go. No test reaches /usr/bin/security.
// `asked` records every name that was looked up, so a test can say what was (and was not) read.
export function fakeKeychain(items:Record<string,string>={}){
 const asked:string[]=[];
 const read:KeychainReader=async name=>{asked.push(name);return Object.hasOwn(items,name)?items[name]:null;};
 return {items,asked,read};
}
