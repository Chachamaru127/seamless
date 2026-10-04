import { MAX_INPUT_BYTES, safeParseJSON } from './protocol.ts';
export async function runLines(handler:(request:unknown)=>Promise<unknown|undefined>,invalid:()=>unknown=()=>({id:null,error:{code:'invalid_request'}})) {
 let buffer=Buffer.alloc(0),oversized=false;
 const write=async(value:unknown)=>{if(value!==undefined)await new Promise<void>((resolve,reject)=>process.stdout.write(JSON.stringify(value)+'\n',error=>error?reject(error):resolve()));};
 const dispatch=async()=>{
  if(oversized){await write(invalid());}else if(buffer.length){let input:unknown;try{input=safeParseJSON(new TextDecoder('utf-8',{fatal:true}).decode(buffer));}catch{await write(invalid());buffer=Buffer.alloc(0);return;}await write(await handler(input));}
  buffer=Buffer.alloc(0);oversized=false;
 };
 for await(const raw of process.stdin){const chunk=Buffer.isBuffer(raw)?raw:Buffer.from(raw);let start=0;
  for(let i=0;i<=chunk.length;i++)if(i===chunk.length||chunk[i]===10){const piece=chunk.subarray(start,i);if(!oversized){if(buffer.length+piece.length>MAX_INPUT_BYTES){oversized=true;buffer=Buffer.alloc(0);}else buffer=Buffer.concat([buffer,piece]);}if(i<chunk.length)await dispatch();start=i+1;}
 }
 if(buffer.length||oversized)await dispatch();
}
