// Trusted, fixed host; NEVER accept JS, WASM bytes, paths, commands or environment from task JSON.
import {fixedCapabilityGuest} from '../src/incubation/synthetic-capability.ts';
process.once('message',async mode=>{
 const {guest,attempts}=await fixedCapabilityGuest();
 process.send({kind:'ready'});
 if(mode==='timeout')guest.spin();
 else if(mode==='crash')guest.trap();
 else if(mode==='success'){
  const results=[0,1,2,3,4].map(id=>guest.attempt(id));
  process.send({kind:'done',attempts,results},()=>process.disconnect());
 }else throw Error('FIXED_PROGRAM_ONLY');
});
