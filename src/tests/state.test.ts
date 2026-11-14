import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,writeFileSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { StateStore,type Batch } from '../lib/state.js';
import { readConfig } from '../config.js';
import { approval,batch,harness } from './helpers.js';

function seed(stage:'reserved'|'upsert'|'event'):Batch {
  const input=batch();
  return {...input,docVersion:1,templateCode:'demo-lunch-notice',simulated:true,status:'requesting',createdAt:new Date().toISOString(),
    recipients:input.recipients.map(r=>({
      memberId:r.memberId,phoneProof:'a'.repeat(64),requestStatus:'pending',deliveryStatus:'unknown',retryCount:0,
      retryable:false,stage,updatedAt:new Date().toISOString(),attempts:[{at:new Date().toISOString(),stage}],
    })),
  };
}
test('one process owns state; corrupted state is never reset or silently accepted',()=>{
  const dir=mkdtempSync(join(tmpdir(),'mawd-state-')),file=join(dir,'state.json');
  try {
    const a=new StateStore(file);
    assert.throws(()=>new StateStore(file),/STATE_IN_USE/);a.close();
    const b=new StateStore(file);b.close();
    for(const text of ['{broken','{"version":1,"batches":{}}','{"version":2,"batches":[],"documents":{}}','{"version":2,"batches":42,"documents":{}}']) {
      writeFileSync(file,text);
      assert.throws(()=>new StateStore(file),/STATE_FILE_INVALID/);
      assert.equal(readFileSync(file,'utf8'),text);
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('process exit leaves durable reservations; recovery distinguishes pre-event from event ambiguity',async t=>{
  for(const stage of ['reserved','upsert','event'] as const)await t.test(stage,()=>{
    const dir=mkdtempSync(join(tmpdir(),'mawd-crash-')),file=join(dir,'state.json'),initial=seed(stage);
    try {
      const moduleUrl=new URL('../lib/state.js',import.meta.url).href;
      const script='import {StateStore} from '+JSON.stringify(moduleUrl)+'; const s=new StateStore(process.argv[1]); s.create(JSON.parse(process.argv[2])); process.exit(0);';
      const child=spawnSync(process.execPath,['--input-type=module','-e',script,file,JSON.stringify(initial)],{encoding:'utf8'});
      assert.equal(child.status,0,child.stderr);
      const store=new StateStore(file);
      try {
        const r=store.publicView(initial.batchKey).recipients[0];
        assert.equal(r.requestStatus,'request_failed');assert.equal(r.deliveryStatus,'unknown');
        assert.equal(r.retryable,stage!=='event');assert.equal(r.stage,stage==='event'?'uncertain':'upsert_failed');
        assert.ok(r.attempts[0].finishedAt);
        assert.throws(()=>store.create(initial),/DUPLICATE_BATCH/);
      } finally {store.close();}
    } finally {rmSync(dir,{recursive:true,force:true});}
  });
});

test('same S2 version cannot be sent with a different template code',()=>{
  const dir=mkdtempSync(join(tmpdir(),'mawd-version-')),file=join(dir,'state.json');
  const store=new StateStore(file);
  try {
    const initial=seed('reserved');store.create(initial);
    assert.throws(()=>store.create({...initial,batchKey:'2026-12:doc-v1:another-template',templateCode:'another-template'}),/DUPLICATE_BATCH/);
    store.setDocument(approval);store.assertApproved('2026-12',1);
    store.setDocument({...approval,planConfirmed:false,approved:false});
    assert.throws(()=>store.assertApproved('2026-12',1),/S2_NOT_CURRENT_APPROVED/);
  } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});

test('default config starts mock with stable private local token, strict loopback and explicit live opt-in',()=>{
  const dir=mkdtempSync(join(tmpdir(),'mawd-config-')),file=join(dir,'state.json');
  try {
    const config=readConfig({DATA_FILE:file});
    assert.equal(config.host,'127.0.0.1');assert.equal(config.linerMode,'mock');assert.equal(config.channelMode,'mock');
    assert.equal(config.linerKey,'');assert.equal(config.channelKey,'');
    assert.equal(config.relayAuthToken,readConfig({DATA_FILE:file}).relayAuthToken);
    for(const env of [
      {HOST:'0.0.0.0'},{CHANNEL_SEND_MODE:'live'},{LINER_MODE:'live'},{ALLOWED_ORIGINS:'*'},
      {UPSTREAM_TIMEOUT_MS:'NaN'},{UPSTREAM_TIMEOUT_MS:'60000'},{RELAY_AUTH_TOKEN:'short'},
      {CHANNEL_TEMPLATE_TEXT:'#{학교} #{월}'},
    ])assert.throws(()=>readConfig({DATA_FILE:file,...env}));
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('manual export creates txt/csv, records handoff, never sends and survives restart without automatic retry',async()=>{
  let calls=0;
  const h=await harness({channel:{upsert:async()=>{calls++;return 'fixture';},trigger:async()=>{calls++;}}},{channelMode:'disabled'});
  const input=batch();
  try {
    await h.approve();
    const response=await h.post('/send/alimtalk/manual',input);assert.equal(response.status,202);
    const value=await response.json();
    assert.equal(value.batch.status,'manual');assert.equal(value.batch.recipients[0].deliveryStatus,'unknown');
    assert.ok(value.files.txt.content.includes('month=12'));assert.ok(value.files.csv.content.includes('01000000000'));
    assert.equal(calls,0);
    assert.ok(!readFileSync(h.cfg.dataFile,'utf8').includes('01000000000'));
    await h.restart();
    assert.equal((await (await h.get('/send/batches/'+input.batchKey)).json()).status,'manual');
    assert.equal((await h.post('/send/alimtalk/manual',input)).status,409);
  } finally {await h.close();}
});

test('manual fallback exports only definite pre-event failures; ambiguous recipients remain blocked',async()=>{
  const h=await harness({channel:{
    upsert:async r=>{if(r.phone.endsWith('0'))throw new Error('upsert failure');return 'fixture';},
    trigger:async()=>{throw new Error('event unknown');},
  }});
  const input=batch();input.recipients.push({memberId:'10000000-0000-4000-8000-000000000001',phone:'01000000001'});
  try {
    await h.approve();await h.post('/send/alimtalk',input);
    assert.equal((await h.post('/send/alimtalk/manual',input)).status,409);
    const safe={...input,recipients:[input.recipients[0]]};
    assert.equal((await h.post('/send/alimtalk/manual',safe)).status,202);
    assert.equal((await h.post('/send/alimtalk/retry',safe)).status,409);
  } finally {await h.close();}
});
