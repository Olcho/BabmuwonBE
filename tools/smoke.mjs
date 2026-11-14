// End-to-end smoke of the real server entry point; uses ONLY mock mode and synthetic input.
import { spawn } from 'node:child_process';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes,randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const temp=await mkdtemp(join(tmpdir(),'mawd-smoke-'));
const token=randomBytes(32).toString('hex');
const child=spawn(process.execPath,[join(root,'dist/server.js')],{
  cwd:root,
  env:{...process.env,HOST:'127.0.0.1',PORT:'0',DATA_FILE:join(temp,'state.json'),
    RELAY_AUTH_TOKEN:token,LINER_MODE:'mock',CHANNEL_SEND_MODE:'mock',ALLOW_REAL_ALIMTALK_SEND:'NO',
    LINER_API_KEY:'',CHANNEL_ACCESS_KEY:'',CHANNEL_ACCESS_SECRET:'',CHANNEL_TEMPLATE_CODE:'demo-lunch-notice',
    CHANNEL_TEMPLATE_TEXT:'[데모학교] #{월}월 급식 안내입니다.',
    ALLOWED_ORIGINS:'http://localhost:5173',UPSTREAM_TIMEOUT_MS:'30000'},
  stdio:['ignore','pipe','pipe'],
});
const exited=new Promise(resolveExit=>child.once('exit',resolveExit));
try {
  const url=await new Promise((resolveUrl,reject)=>{
    const timer=setTimeout(()=>reject(new Error('SMOKE_START_TIMEOUT')),10000);
    let output='';
    child.stdout.on('data',chunk=>{
      output+=chunk.toString();
      const match=/http:\/\/127\.0\.0\.1:\d+/.exec(output);
      if(match){clearTimeout(timer);resolveUrl(match[0]);}
    });
    child.once('error',()=>{clearTimeout(timer);reject(new Error('SMOKE_START_FAILED'));});
    child.once('exit',()=>{clearTimeout(timer);reject(new Error('SMOKE_SERVER_EXITED'));});
  });
  const post=(path,body)=>fetch(url+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await fetch(url+'/health')).status,200);
  for(const [path,body] of [
    ['/ai/s2-news',{month:'2026-12',menus:['닭갈비','귤']}],
    ['/ai/nutrition',{topicId:'balanced_meals'}],
    ['/ai/substitute-evidence',{allergenNo:1,foodName:'두부조림'}],
    ['/ai/s5-body',{counts:{byAllergen:[],provided:3,excluded:'3명 미만'}}],
  ]) {
    const response=await post(path,body);assert.equal(response.status,200);
    const value=await response.json();assert.equal(value.simulated,true);assert.equal(value.reviewRequired,true);
  }
  assert.equal((await post('/local/s2-state',{month:'2026-12',planVersion:1,planConfirmed:true,docVersion:1,basedOnPlanVersion:1,approved:true})).status,200);
  const batch={batchKey:'2026-12:doc-v1:demo-lunch-notice',month:'2026-12',recipients:[{memberId:randomUUID(),phone:'01000000000'}]};
  const sent=await post('/send/alimtalk',batch);assert.equal(sent.status,202);
  const result=await sent.json();assert.equal(result.simulated,true);assert.equal(result.recipients[0].deliveryStatus,'unknown');
  assert.equal((await post('/send/alimtalk',batch)).status,409);
  console.log('SMOKE PASS: server entry, health, four AI routes, approval, mock send, duplicate 409; external calls=0');
} finally {
  if(child.exitCode===null)child.kill('SIGTERM');
  await exited;
  // Resolve and check the generated temporary directory before recursive cleanup.
  if(dirname(resolve(temp))!==resolve(tmpdir()) || !temp.includes('mawd-smoke-'))throw new Error('UNEXPECTED_TEMP_PATH');
  await rm(temp,{recursive:true,force:true});
}
