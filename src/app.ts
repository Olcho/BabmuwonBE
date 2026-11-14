import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import type { Config } from './config.js';
import { ApiError } from './lib/errors.js';
import { demoFoods } from './lib/catalog.js';
import { authorize,cors,jsonBody,reply } from './lib/http.js';
import { AuditStore } from './lib/audit.js';
import { MAX_SEND_RETRIES,StateStore,type RecipientState } from './lib/state.js';
import { validateEvidence,validateNews,validateNutrition,validateS5,validateSend,validateDocument,topicMap,type SendInput } from './lib/validation.js';
import { LinerSearchError,LinerService } from './providers/liner.js';
import { ChannelService,type ChannelProvider } from './providers/channel.js';
import type { Fetch } from './lib/upstream.js';

const now=()=>new Date().toISOString();
const paths=['/health','/audit','/catalog','/local/s2-state','/ai/s2-news','/ai/nutrition','/ai/substitute-evidence','/ai/s5-body','/send/alimtalk','/send/alimtalk/retry','/send/alimtalk/manual'];
export interface AppDependencies { fetcher?:Fetch; channel?:ChannelProvider }
export function createApp(config:Config,dependencies:AppDependencies={}) {
  const audit=new AuditStore(),store=new StateStore(config.dataFile);
  const liner=new LinerService(config,dependencies.fetcher),channel=dependencies.channel??new ChannelService(config,dependencies.fetcher);
  const activeMonths=new Set<string>();
  const proof=(id:string,phone:string)=>createHmac('sha256',config.relayAuthToken).update(id+'|'+phone).digest('hex');
  const recipient=(input:SendInput['recipients'][number]):RecipientState=>({
    memberId:input.memberId,phoneProof:proof(input.memberId,input.phone),requestStatus:'pending',
    deliveryStatus:'unknown',retryCount:0,retryable:false,stage:'reserved',updatedAt:now(),attempts:[{at:now(),stage:'reserved'}],
  });
  function updateRecipient(key:string,id:string,stage:RecipientState['stage'],errorCode?:string) {
    store.update(key,b=>{
      const r=b.recipients.find(x=>x.memberId===id)!;
      r.stage=stage;r.updatedAt=now();r.errorCode=errorCode;
      r.requestStatus=stage==='requested'?'requested':['upsert_failed','uncertain'].includes(stage)?'request_failed':'pending';
      r.retryable=stage==='upsert_failed';
      const attempt=r.attempts.at(-1)!;attempt.stage=stage;attempt.errorCode=errorCode;
      if(r.requestStatus!=='pending')attempt.finishedAt=now();
    });
  }
  async function send(raw:unknown,retry=false) {
    if(config.channelMode==='disabled' || (config.channelMode==='live' && !config.realSendEnabled))throw new ApiError(503,'CHANNEL_SEND_DISABLED');
    const input=validateSend(raw);
    if(input.templateCode!==config.templateCode)throw new ApiError(400,'TEMPLATE_NOT_CONFIGURED');
    // All reservations below are synchronous and durable before the first network await.
    if(!retry && store.get(input.batchKey))throw new ApiError(409,'DUPLICATE_BATCH');
    store.assertApproved(input.month,input.docVersion);
    if(activeMonths.has(input.month))throw new ApiError(409,'BATCH_BUSY');
    if(!retry) {
      store.create({
        batchKey:input.batchKey,month:input.month,docVersion:input.docVersion,templateCode:input.templateCode,
        simulated:config.channelMode==='mock',status:'requesting',createdAt:now(),recipients:input.recipients.map(recipient),
      });
    } else {
      const old=store.get(input.batchKey);
      if(!old)throw new ApiError(404,'BATCH_NOT_FOUND');
      if(old.simulated!==(config.channelMode==='mock'))throw new ApiError(409,'BATCH_MODE_MISMATCH');
      for(const entry of input.recipients) {
        const r=old.recipients.find(x=>x.memberId===entry.memberId);
        if(!r || r.phoneProof!==proof(entry.memberId,entry.phone))throw new ApiError(409,'RECIPIENT_MISMATCH');
        if(r.requestStatus!=='request_failed' || !r.retryable || r.stage!=='upsert_failed')throw new ApiError(409,'RETRY_NOT_ALLOWED');
        if(r.retryCount>=MAX_SEND_RETRIES)throw new ApiError(409,'MAX_RETRIES_REACHED');
      }
      store.update(input.batchKey,b=>{
        for(const entry of input.recipients) {
          const r=b.recipients.find(x=>x.memberId===entry.memberId)!;
          r.retryCount++;r.requestStatus='pending';r.stage='reserved';r.retryable=false;r.errorCode=undefined;
          r.updatedAt=now();r.attempts.push({at:now(),stage:'reserved'});
        }
      });
    }
    activeMonths.add(input.month);
    try {
      for(const entry of input.recipients) {
        updateRecipient(input.batchKey,entry.memberId,'upsert');
        let userId:string;
        try {userId=await channel.upsert(entry);}
        catch {updateRecipient(input.batchKey,entry.memberId,'upsert_failed','CHANNEL_UPSERT_FAILED');continue;}
        // Write-ahead marker: after this point, any failure prohibits automatic resends.
        updateRecipient(input.batchKey,entry.memberId,'event');
        try {await channel.trigger(userId,input.month);}
        catch {updateRecipient(input.batchKey,entry.memberId,'uncertain','EVENT_OUTCOME_UNKNOWN');continue;}
        updateRecipient(input.batchKey,entry.memberId,'requested');
      }
      return store.publicView(input.batchKey);
    } finally {activeMonths.delete(input.month);}
  }
  function manual(raw:unknown) {
    const input=validateSend(raw);
    if(input.templateCode!==config.templateCode)throw new ApiError(400,'TEMPLATE_NOT_CONFIGURED');
    store.assertApproved(input.month,input.docVersion);
    if(activeMonths.has(input.month))throw new ApiError(409,'BATCH_BUSY');
    const old=store.get(input.batchKey);
    if(old) {
      for(const entry of input.recipients) {
        const r=old.recipients.find(x=>x.memberId===entry.memberId);
        if(!r || r.phoneProof!==proof(entry.memberId,entry.phone))throw new ApiError(409,'RECIPIENT_MISMATCH');
        if(r.requestStatus!=='request_failed' || !r.retryable)throw new ApiError(409,'MANUAL_EXPORT_NOT_ALLOWED');
      }
      store.update(input.batchKey,b=>{
        for(const entry of input.recipients) {
          const r=b.recipients.find(x=>x.memberId===entry.memberId)!;
          r.stage='manual';r.requestStatus='pending';r.retryable=false;r.updatedAt=now();r.errorCode=undefined;
          r.attempts.push({at:now(),finishedAt:now(),stage:'manual'});
        }
      });
    } else {
      store.create({
        batchKey:input.batchKey,month:input.month,docVersion:input.docVersion,templateCode:input.templateCode,
        simulated:config.channelMode!=='live',status:'manual',createdAt:now(),
        recipients:input.recipients.map(entry=>{
          const r=recipient(entry);r.stage='manual';r.attempts=[{at:now(),finishedAt:now(),stage:'manual'}];return r;
        }),
      });
    }
    const month=String(Number(input.month.slice(5)));
    return {batch:store.publicView(input.batchKey),files:{
      txt:{filename:input.month+'_alimtalk.txt',content:'templateCode='+config.templateCode+'\nmonth='+month+'\n'+config.templateText.replace('#{월}',month)},
      csv:{filename:input.month+'_recipients.csv',content:'memberId,phone\r\n'+input.recipients.map(r=>r.memberId+','+r.phone).join('\r\n')+'\r\n'},
    }};
  }
  const app=createServer(async(req,res)=>{
    const start=Date.now();let endpoint='unknown';
    try {
      cors(req,res,config);
      const url=new URL(req.url??'/','http://127.0.0.1');
      const path=url.pathname;
      endpoint=paths.includes(path)?path:path.startsWith('/send/batches/')?'/send/batches/:batchKey':'unknown';
      if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
      if(req.method==='GET' && path==='/health') {
        reply(res,200,{status:'ok',service:'mawd-relay',linerMode:config.linerMode,channelMode:config.channelMode,localOnly:true});return;
      }
      authorize(req,config);
      if(req.method==='GET') {
        if(path==='/audit'){reply(res,200,{events:audit.list()});return;}
        if(path==='/catalog'){reply(res,200,{foods:demoFoods,topics:topicMap,templateCode:config.templateCode,templateText:config.templateText});return;}
        if(path.startsWith('/send/batches/')) {
          let key:string;
          try {key=decodeURIComponent(path.slice('/send/batches/'.length));}catch {throw new ApiError(400,'INVALID_REQUEST');}
          reply(res,200,store.publicView(key));return;
        }
      }
      if(req.method!=='POST' || !paths.includes(path))throw new ApiError(404,'NOT_FOUND');
      const body=await jsonBody(req);
      let output:unknown;
      switch(path) {
        case '/ai/s2-news':output=await liner.s2News(validateNews(body));break;
        case '/ai/nutrition':output=await liner.nutrition(validateNutrition(body));break;
        case '/ai/substitute-evidence':output=await liner.substituteEvidence(validateEvidence(body));break;
        case '/ai/s5-body':output=await liner.s5(validateS5(body));break;
        case '/local/s2-state': {
          const d=validateDocument(body);
          if(activeMonths.has(d.month))throw new ApiError(409,'BATCH_BUSY');
          store.setDocument(d);output={...d,approvalSource:'local-client-attestation'};break;
        }
        case '/send/alimtalk':output=await send(body);break;
        case '/send/alimtalk/retry':output=await send(body,true);break;
        case '/send/alimtalk/manual':output=manual(body);break;
        default:throw new ApiError(404,'NOT_FOUND');
      }
      const status=path.startsWith('/send/')?202:200;
      audit.add(endpoint,(output as {cached?:boolean}).cached?'cached':'ok',Date.now()-start,status);
      reply(res,status,output);
    } catch(err) {
      const e=err instanceof ApiError?err:new ApiError(500,'INTERNAL_ERROR');
      audit.add(endpoint,e.code,Date.now()-start,e.status,e instanceof LinerSearchError ? e.diagnostic : undefined);
      if(!res.headersSent)reply(res,e.status,{error:e.code});else res.end();
    }
  });
  app.requestTimeout=30000;
  app.headersTimeout=10000;
  app.on('close',()=>store.close());
  return app;
}
