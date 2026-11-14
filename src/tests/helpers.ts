import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp,type AppDependencies } from '../app.js';
import { randomTestConfig,type Config } from '../config.js';

export const approval={month:'2026-12',planVersion:1,planConfirmed:true,docVersion:1,basedOnPlanVersion:1,approved:true};
export const batch=(version=1)=>({
  batchKey:'2026-12:doc-v'+version+':demo-lunch-notice',month:'2026-12',
  // Synthetic fixture; never call a real provider from tests.
  recipients:[{memberId:randomUUID(),phone:'01000000000'}],
});
export function deferred<T=void>() {
  let resolve!:(value:T|PromiseLike<T>)=>void;
  const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};
}
export async function harness(deps:AppDependencies={},overrides:Partial<Config>={}) {
  const dir=mkdtempSync(join(tmpdir(),'mawd-relay-test-'));
  const cfg={...randomTestConfig(join(dir,'state.json')),...overrides};
  let server=createApp(cfg,deps);
  let url='';
  async function listen() {
    await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
    const address=server.address();if(!address || typeof address==='string')throw new Error('bind');
    url='http://127.0.0.1:'+address.port;
  }
  async function stop() {
    await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
  }
  await listen();
  const post=(path:string,body:unknown,token=cfg.relayAuthToken)=>fetch(url+path,{method:'POST',
    headers:{authorization:'Bearer '+token,'content-type':'application/json',origin:'http://localhost:5173'},body:JSON.stringify(body)});
  const get=(path:string)=>fetch(url+path,{headers:{authorization:'Bearer '+cfg.relayAuthToken}});
  return {
    dir,cfg,post,get,get url(){return url;},
    approve:()=>post('/local/s2-state',approval),
    restart:async()=>{await stop();server=createApp(cfg,deps);await listen();},
    close:async()=>{await stop();rmSync(dir,{recursive:true,force:true});},
  };
}
