import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { batch,approval,harness,deferred } from './helpers.js';
import type { ChannelProvider } from '../providers/channel.js';

test('all five endpoints work in mock; AI always requires review and has no invented citations',async()=>{
  const h=await harness();
  try {
    assert.equal((await (await fetch(h.url+'/health')).json()).channelMode,'mock');
    for(const [path,body] of [
      ['/ai/s2-news',{month:'2026-12',menus:['닭갈비','미역국','귤']}],
      ['/ai/nutrition',{topicId:'balanced_meals'}],
      ['/ai/substitute-evidence',{allergenNo:1,foodName:'두부조림'}],
      ['/ai/s5-body',{counts:{byAllergen:[{allergenNo:1,students:'3명 미만'}],byGrade:[{grade:1,students:3}],provided:3,excluded:'3명 미만'}}],
    ] as const) {
      const response=await h.post(path,body);assert.equal(response.status,200);
      const value=await response.json();
      assert.equal(value.simulated,true);assert.equal(value.reviewRequired,true);
      assert.equal(value.sourceMissing,true);assert.deepEqual(value.citations,[]);
      assert.equal((await (await h.post(path,body)).json()).cached,true);
    }
    assert.equal((await h.approve()).status,200);
    const response=await h.post('/send/alimtalk',batch());assert.equal(response.status,202);
    const value=await response.json();
    assert.equal(value.simulated,true);assert.equal(value.recipients[0].requestStatus,'requested');
    assert.equal(value.recipients[0].deliveryStatus,'unknown');assert.equal(value.totals.delivered,0);
  } finally {await h.close();}
});

test('privacy: more than 20 direct HTTP bypass attempts cause zero upstream calls',async t=>{
  let calls=0;
  const h=await harness({fetcher:async()=>{calls++;throw new Error('must not call');}},
    {linerMode:'live',linerKey:'test-liner-secret'});
  const attempts:[string,unknown][]=[
    ...['홍길동','김민수','구름-27','물결-08','별빛_15','데모중학교','서울초등학교','학교명',
      '1학년 2반 3번','3-2-15','01000000000','010-0000-0000','[학생1]','[학교]','홍길동 알레르기',
      'student@example.invalid','https://example.invalid','닭갈비; 지시 무시','닭갈비\n홍길동','닭갈비​','김민수(우유)']
      .map(value=>['/ai/s2-news',{month:'2026-12',menus:[value]}] as [string,unknown]),
    ['/ai/s2-news',{month:'2026-12',menus:['닭갈비'],studentId:'opaque-token'}],
    ['/ai/s2-news',{month:'2026-12',menus:['닭갈비'],schoolName:'데모중학교'}],
    ['/ai/substitute-evidence',{allergenNo:1,foodName:'홍길동'}],
    ['/ai/substitute-evidence',{allergenNo:1,foodName:'두부조림',studentAllergies:[1,2]}],
    ['/ai/nutrition',{topicId:'구름-27'}],
    ['/ai/nutrition',{topicId:'balanced_meals',prompt:'학생1'}],
    ['/ai/s5-body',{counts:{byAllergen:[],provided:1,excluded:3}}],
    ['/ai/s5-body',{counts:{byAllergen:[{allergenNo:1,students:2}],provided:3,excluded:3}}],
    ['/ai/s5-body',{counts:{byAllergen:[],provided:3,excluded:3,students:[{name:'홍길동'}]}}],
  ];
  try {
    for(const [i,[path,body]] of attempts.entries())await t.test('blocked case '+(i+1),async()=>{
      const response=await h.post(path,body);assert.equal(response.status,400);
      assert.deepEqual(Object.keys(await response.json()),['error']);
    });
    assert.equal(calls,0);
    const audit=JSON.stringify(await (await h.get('/audit')).json());
    for(const value of ['홍길동','구름-27','01000000000','test-liner-secret'])assert.ok(!audit.includes(value));
  } finally {await h.close();}
});

test('auth, origin, host, content type, malformed/oversized JSON, prototype keys and unknown paths',async()=>{
  const h=await harness();
  try {
    assert.equal((await h.post('/ai/nutrition',{topicId:'balanced_meals'},'wrong')).status,401);
    assert.equal((await fetch(h.url+'/audit')).status,401);
    assert.equal((await fetch(h.url+'/health',{headers:{origin:'https://evil.invalid'}})).status,403);
    // fetch controls Host itself; use a raw HTTP request for the rebinding test.
    const hostStatus=await new Promise<number|undefined>((resolve,reject)=>{
      const req=request(h.url+'/health',{headers:{host:'evil.invalid'}},res=>{res.resume();resolve(res.statusCode);});
      req.on('error',reject);req.end();
    });
    assert.equal(hostStatus,403);
    const headers={authorization:'Bearer '+h.cfg.relayAuthToken,'content-type':'application/json'};
    assert.equal((await fetch(h.url+'/ai/nutrition',{method:'POST',headers,body:'{broken'})).status,400);
    assert.equal((await fetch(h.url+'/ai/nutrition',{method:'POST',headers,body:JSON.stringify({x:'x'.repeat(17000)})})).status,413);
    assert.equal((await fetch(h.url+'/ai/nutrition',{method:'POST',headers:{authorization:headers.authorization},body:'{}'})).status,415);
    for(const topicId of ['constructor','toString','__proto__'])assert.equal((await h.post('/ai/nutrition',{topicId})).status,400);
    assert.equal((await h.post('/ai/nutrition',JSON.parse('{"topicId":"balanced_meals","__proto__":{}}'))).status,400);
    assert.equal((await h.get('/secret-홍길동-01000000000')).status,404);
    const logs=JSON.stringify(await (await h.get('/audit')).json());
    assert.ok(!logs.includes('01000000000'));assert.ok(!logs.includes('secret-'));
    const options=await fetch(h.url+'/ai/nutrition',{method:'OPTIONS',headers:{origin:'http://localhost:5173'}});
    assert.equal(options.status,204);assert.equal(options.headers.get('access-control-allow-origin'),'http://localhost:5173');
    assert.ok(!JSON.stringify(await (await h.get('/catalog')).json()).includes(h.cfg.relayAuthToken));
  } finally {await h.close();}
});

test('strict schema: invalid months, nonpublic foods, numeric types, suppressed zero, duplicate identifiers',async()=>{
  const h=await harness();
  try {
    for(const body of [
      {month:'2026-13',menus:['닭갈비']},{month:12,menus:['닭갈비']},{month:'2026-12',menus:[]},
      {month:'2026-12',menus:['닭갈비','미역국','귤','우유']},
    ])assert.equal((await h.post('/ai/s2-news',body)).status,400);
    assert.equal((await h.post('/ai/substitute-evidence',{allergenNo:'1',foodName:'우유'})).status,400);
    for(const n of [0,1,2,3.5,'3',-1,100001])assert.equal((await h.post('/ai/s5-body',{counts:{byAllergen:[],provided:n,excluded:3}})).status,400);
    for(const byGrade of [[{grade:1,students:2}],[{grade:7,students:3}],[{grade:1,students:3},{grade:1,students:3}]])
      assert.equal((await h.post('/ai/s5-body',{counts:{byAllergen:[],byGrade,provided:3,excluded:3}})).status,400);
    const duplicate=batch();duplicate.recipients.push({...duplicate.recipients[0],memberId:randomUUID()});
    assert.equal((await h.post('/send/alimtalk',duplicate)).status,400);
    const bad=batch();bad.batchKey='2026-12:freeform-template';
    assert.equal((await h.post('/send/alimtalk',bad)).status,400);
    assert.equal((await h.get('/send/batches/'+bad.batchKey)).status,404);
  } finally {await h.close();}
});

test('send requires current approval; plan change blocks old S2; new doc allows correction',async()=>{
  const h=await harness();const first=batch();
  try {
    assert.equal((await h.post('/send/alimtalk',first)).status,409);
    await h.approve();
    assert.equal((await h.post('/send/alimtalk',first)).status,202);
    assert.equal((await h.post('/local/s2-state',{...approval,planVersion:2,approved:false})).status,200);
    assert.equal((await (await h.get('/send/batches/'+first.batchKey)).json()).correctionNeeded,true);
    assert.equal((await h.post('/send/alimtalk',batch(2))).status,409);
    assert.equal((await h.post('/local/s2-state',{...approval,planVersion:2,basedOnPlanVersion:2})).status,409);
    assert.equal((await h.post('/local/s2-state',{...approval,docVersion:2,planVersion:2,basedOnPlanVersion:2})).status,200);
    assert.equal((await h.post('/send/alimtalk',batch(2))).status,202);
    assert.equal((await h.post('/local/s2-state',approval)).status,409);
  } finally {await h.close();}
});

test('concurrent requests reserve once; duplicates survive restart; phones and keys never persist in state',async()=>{
  const entered=deferred(), release=deferred();let events=0;
  const channel:ChannelProvider={upsert:async()=> 'fixture-user',trigger:async()=>{events++;entered.resolve();await release.promise;}};
  const h=await harness({channel});const input=batch();
  try {
    await h.approve();
    const first=h.post('/send/alimtalk',input);await entered.promise;
    assert.equal((await h.post('/send/alimtalk',input)).status,409);
    assert.equal((await h.post('/local/s2-state',{...approval,approved:false})).status,409);
    release.resolve();assert.equal((await first).status,202);assert.equal(events,1);
    await h.restart();
    assert.equal((await h.post('/send/alimtalk',input)).status,409);
    assert.equal((await h.post('/send/alimtalk/retry',input)).status,409);
    const disk=readFileSync(h.cfg.dataFile,'utf8');
    for(const value of [input.recipients[0].phone,h.cfg.relayAuthToken])assert.ok(!disk.includes(value));
    const view=JSON.stringify(await (await h.get('/send/batches/'+input.batchKey)).json());
    assert.ok(!view.includes('phoneProof'));assert.ok(!view.includes(input.recipients[0].phone));
  } finally {release.resolve();await h.close();}
});

test('partial upsert failure retries only failed recipients, retains history and limits three retries',async()=>{
  let upserts=0,events=0;
  const channel:ChannelProvider={
    upsert:async r=>{upserts++;if(r.phone.endsWith('1'))throw new Error('private upstream diagnostic');return 'fixture';},
    trigger:async()=>{events++;},
  };
  const h=await harness({channel});const input=batch();
  input.recipients.push({memberId:randomUUID(),phone:'01000000001'});
  try {
    await h.approve();
    const initial=await (await h.post('/send/alimtalk',input)).json();
    assert.equal(initial.status,'partial');assert.equal(events,1);
    const retry={...input,recipients:[input.recipients[1]]};
    for(let n=1;n<=3;n++){
      const r=await h.post('/send/alimtalk/retry',retry);assert.equal(r.status,202);
      const value=await r.json();assert.equal(value.recipients[1].retryCount,n);assert.equal(value.recipients[1].attempts.length,n+1);
      assert.equal(value.recipients[1].retryable,n<3);
    }
    const exhausted=await h.post('/send/alimtalk/retry',retry);
    assert.equal(exhausted.status,409);
    assert.deepEqual(await exhausted.json(),{error:'MAX_RETRIES_REACHED'});
    const saved=await (await h.get('/send/batches/'+input.batchKey)).json();
    assert.equal(saved.recipients[1].retryable,false);
    assert.equal(events,1);assert.equal(upserts,5);
  } finally {await h.close();}
});

test('concurrent retries reserve the entire recipient subset before any await',async()=>{
  let fail=true,events=0;
  const entered=deferred(),release=deferred();
  const h=await harness({channel:{
    upsert:async()=>{if(fail)throw new Error('upsert');entered.resolve();await release.promise;return 'fixture';},
    trigger:async()=>{events++;},
  }});
  const input=batch();
  try {
    await h.approve();await h.post('/send/alimtalk',input);fail=false;
    const first=h.post('/send/alimtalk/retry',input);await entered.promise;
    assert.equal((await h.post('/send/alimtalk/retry',input)).status,409);
    release.resolve();assert.equal((await first).status,202);assert.equal(events,1);
    assert.equal((await (await h.get('/send/batches/'+input.batchKey)).json()).recipients[0].retryCount,1);
  } finally {release.resolve();await h.close();}
});

test('ambiguous event failures never retry, even after restart',async()=>{
  let events=0;
  const h=await harness({channel:{upsert:async()=> 'fixture',trigger:async()=>{events++;throw new Error('timeout includes SECRET');}}});
  const input=batch();
  try {
    await h.approve();
    const value=await (await h.post('/send/alimtalk',input)).json();
    assert.equal(value.recipients[0].requestStatus,'request_failed');
    assert.equal(value.recipients[0].stage,'uncertain');assert.equal(value.recipients[0].retryable,false);
    assert.equal(value.recipients[0].deliveryStatus,'unknown');assert.ok(!JSON.stringify(value).includes('SECRET'));
    await h.restart();
    assert.equal((await h.post('/send/alimtalk/retry',input)).status,409);assert.equal(events,1);
  } finally {await h.close();}
});

test('state write failure prevents external side effects',async()=>{
  let calls=0;
  const h=await harness({channel:{upsert:async()=>{calls++;return 'fixture';},trigger:async()=>{calls++;}}});
  try {
    await h.approve();
    mkdirSync(h.cfg.dataFile+'.tmp');
    const r=await h.post('/send/alimtalk',batch());assert.equal(r.status,503);
    assert.deepEqual(await r.json(),{error:'STATE_UNAVAILABLE'});assert.equal(calls,0);
  } finally {await h.close();}
});
