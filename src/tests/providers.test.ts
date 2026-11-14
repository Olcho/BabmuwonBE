import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomTestConfig } from '../config.js';
import { LinerService,parseSearchSse } from '../providers/liner.js';
import { ChannelService } from '../providers/channel.js';
import { ApiError } from '../lib/errors.js';
import { LinerLimiter,SimpleCache } from '../lib/rate.js';
import type { Fetch } from '../lib/upstream.js';

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const sse=(events:unknown[],done=true)=>events.map(e=>'event: data\ndata: '+JSON.stringify(e)+'\n\n').join('')+(done?'data: [DONE]\n\n':'');
const successSse=sse([
  {type:'start'},{type:'data-search-references',data:{references:[
    {title:'Fixture reference',url:'https://example.invalid/reference'},
    {title:'unsafe',url:'javascript:alert(1)'},{url:'https://user:pass@example.invalid'},
  ]}},
  {type:'text-delta',delta:'검토가 필요한 초안'},{type:'text-end'},{type:'finish'},
]);
const live=()=>({...randomTestConfig('unused'),linerMode:'live' as const,linerKey:'test-liner-secret',
  channelMode:'live' as const,realSendEnabled:true,channelKey:'test-channel-key',channelSecret:'test-channel-secret'});
const rejectsCode=(promise:Promise<unknown>,code:string)=>assert.rejects(promise,e=>e instanceof ApiError && e.code===code);

test('Liner Router sends only a structured prompt with documented model, endpoint and auth',async()=>{
  let calls=0;
  const provider=new LinerService(live(),async(url,init)=>{
    calls++;assert.equal(url,'https://platform.liner.com/api/v1/chat/completions');
    assert.equal((init?.headers as Record<string,string>)['x-api-key'],'test-liner-secret');
    assert.equal(init?.redirect,'error');
    const body=JSON.parse(init?.body as string);
    assert.equal(body.model,'liner-gpt-router');assert.equal(body.stream,false);
    assert.ok(body.messages[1].content.includes('닭갈비'));assert.ok(!JSON.stringify(body).includes('test-liner-secret'));
    return json({choices:[{message:{content:'검토할 안내문'},finish_reason:'stop'}]});
  });
  const a=await provider.s2News({month:'2026-12',menus:['닭갈비']});
  assert.equal(a.simulated,false);assert.equal(a.reviewRequired,true);assert.equal(a.source,'router');
  assert.equal((await provider.s2News({month:'2026-12',menus:['닭갈비']})).cached,true);assert.equal(calls,1);
});

test('Search sends stream=true; split UTF-8 chunks, CRLF, comments and safe citations parse',async()=>{
  const provider=new LinerService(live(),async(url,init)=>{
    assert.equal(url,'https://platform.liner.com/api/v1/agents/search');
    const body=JSON.parse(init?.body as string);
    assert.equal(body.stream,true);assert.equal(body.lang,'ko');assert.equal(body.mode,'general');
    const bytes=new TextEncoder().encode(':ping\n\n'+successSse.replace(/\n/g,'\r\n'));
    return new Response(new ReadableStream({start(controller){
      for(let i=0;i<bytes.length;i+=7)controller.enqueue(bytes.slice(i,i+7));
      controller.close();
    }}),{headers:{'content-type':'text/event-stream'}});
  });
  const result=await provider.nutrition({topicId:'balanced_meals'});
  assert.equal(result.text,'검토가 필요한 초안');assert.equal(result.citations.length,1);
  assert.equal(result.sourceMissing,false);assert.equal(result.simulated,false);
});

test('Search treats HTTP-200 data-error, missing finish/done, invalid JSON and empty answer as errors',async t=>{
  const failures=[
    sse([{type:'text-delta',delta:'partial'},{type:'data-error',data:{message:'SECRET'}},{type:'finish'}]),
    sse([{type:'text-delta',delta:'partial'}]),
    sse([{type:'text-delta',delta:'partial'},{type:'finish'}],false),
    'data: {invalid}\n\ndata: [DONE]\n\n',
    sse([{type:'finish'}]),
  ];
  for(const [i,body] of failures.entries())await t.test('reject stream '+i,async()=>{
    const provider=new LinerService(live(),async()=>new Response(body,{headers:{'content-type':'text/event-stream'}}));
    await assert.rejects(provider.nutrition({topicId:'balanced_meals'}),e=>e instanceof ApiError && !e.message.includes('SECRET'));
  });
  assert.throws(()=>parseSearchSse(successSse+'data: {"type":"text-delta","delta":"late"}\n\n'),ApiError);
});

test('upstream 401/429/500, malformed/oversize response and network errors are safe and uncached',async t=>{
  for(const [status,code] of [[401,'LINER_AUTH_FAILED'],[429,'LINER_RATE_LIMITED'],[500,'LINER_UPSTREAM_ERROR']] as const) {
    await t.test(String(status),async()=>{
      let calls=0;
      const provider=new LinerService(live(),async()=>{calls++;return json({error:'SECRET_PHONE'},status);});
      await rejectsCode(provider.nutrition({topicId:'balanced_meals'}),code);
      await rejectsCode(provider.nutrition({topicId:'balanced_meals'}),code);
      assert.equal(calls,2);
    });
  }
  await rejectsCode(new LinerService(live(),async()=>{throw new Error('SECRET');}).nutrition({topicId:'balanced_meals'}),'LINER_UPSTREAM_ERROR');
  await rejectsCode(new LinerService(live(),async()=>new Response('{oops')).s2News({month:'2026-12',menus:['귤']}),'UPSTREAM_INVALID_RESPONSE');
  await rejectsCode(new LinerService(live(),async()=>new Response('x'.repeat(1024*1024+1))).s2News({month:'2026-12',menus:['귤']}),'UPSTREAM_RESPONSE_TOO_LARGE');
});

test('deadline covers upstream connection and aborts without exposing payload',async()=>{
  const fetcher:Fetch=async(_url,init)=>new Promise((_resolve,reject)=>{
    init?.signal?.addEventListener('abort',()=>reject(new Error('PRIVATE timeout payload')),{once:true});
  });
  const provider=new LinerService({...live(),upstreamTimeoutMs:20},fetcher);
  await rejectsCode(provider.nutrition({topicId:'balanced_meals'}),'LINER_TIMEOUT');
});

test('in-flight identical queries coalesce; truncated Router output and credential echo are refused',async()=>{
  let calls=0;
  const provider=new LinerService(live(),async()=>{calls++;return json({choices:[{message:{content:'초안'},finish_reason:'stop'}]});});
  const results=await Promise.all(Array.from({length:8},()=>provider.s2News({month:'2026-12',menus:['귤']})));
  assert.equal(calls,1);assert.equal(results.filter(r=>r.cached).length,7);
  for(const [content,finish_reason] of [['partial','length'],['test-liner-secret','stop']]) {
    const p=new LinerService(live(),async()=>json({choices:[{message:{content},finish_reason}]}));
    await assert.rejects(p.s2News({month:'2026-12',menus:['귤']}),ApiError);
  }
});

test('Channel uses documented /open/v5 and minimal fields; only recognized event is requested',async()=>{
  const calls:{url:string;body:unknown}[]=[];
  const cfg=live();
  const channel=new ChannelService(cfg,async(url,init)=>{
    const body=JSON.parse(init?.body as string);calls.push({url:String(url),body});
    assert.equal((init?.headers as Record<string,string>)['x-access-key'],'test-channel-key');
    assert.equal((init?.headers as Record<string,string>)['x-access-secret'],'test-channel-secret');
    return init?.method==='PUT'?json({user:{id:'fixture-user'}}):json({event:{id:'fixture-event',name:'lunch_notice_requested',userId:'fixture-user'}});
  });
  const id=await channel.upsert({memberId:'10000000-0000-4000-8000-000000000000',phone:'01000000000'});
  await channel.trigger(id,'2026-01');
  assert.deepEqual(calls,[
    {url:'https://api.channel.io/open/v5/users/@10000000-0000-4000-8000-000000000000',body:{profile:{mobileNumber:'+821000000000'}}},
    {url:'https://api.channel.io/open/v5/users/fixture-user/events',body:{name:'lunch_notice_requested',property:{month:'1'}}},
  ]);
  await assert.rejects(new ChannelService(cfg,async()=>json({ok:true})).trigger(id,'2026-12'),ApiError);
  await rejectsCode(new ChannelService({...cfg,realSendEnabled:false},async()=>{throw new Error('must not call');}).trigger(id,'2026-12'),'CHANNEL_SEND_DISABLED');
});

test('one Liner limiter serializes reservations at less than two calls per second',async()=>{
  const limiter=new LinerLimiter();
  const starts=await Promise.all([1,2,3].map(async()=>{await limiter.wait();return performance.now();}));
  assert.ok(starts[1]-starts[0]>=500);assert.ok(starts[2]-starts[1]>=500);
  const cache=new SimpleCache();cache.set('expired','value',-1);assert.equal(cache.get('expired'),undefined);
});
