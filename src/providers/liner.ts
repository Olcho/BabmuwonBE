import { createHash } from 'node:crypto';
import type { Config } from '../config.js';
import { ApiError } from '../lib/errors.js';
import { LinerLimiter,SimpleCache } from '../lib/rate.js';
import { upstream,parseJson,record,type Fetch } from '../lib/upstream.js';
import { topicMap,type NewsInput,type NutritionInput,type EvidenceInput,type S5Input } from '../lib/validation.js';

const allergens:Record<number,string>={1:'난류',2:'우유',3:'메밀',4:'땅콩',5:'대두',6:'밀',7:'고등어',8:'게',9:'새우',10:'돼지고기',11:'복숭아',12:'토마토',13:'아황산류',14:'호두',15:'닭고기',16:'쇠고기',17:'오징어',18:'조개류',19:'잣'};
export interface AIResult {
  text:string; citations:{title:string;url:string}[]; simulated:boolean; cached:boolean;
  reviewRequired:true; sourceMissing:boolean; source:'mock'|'router'|'search';
}
function citations(value:unknown):AIResult['citations'] {
  if(value===undefined)return [];
  if(!Array.isArray(value))throw new ApiError(502,'LINER_INVALID_RESPONSE');
  return value.flatMap(item=>{
    if(!item || typeof item!=='object')return [];
    const r=item as Record<string,unknown>;
    if(typeof r.url!=='string')return [];
    try {
      const url=new URL(r.url);
      if(!['http:','https:'].includes(url.protocol) || url.username || url.password)return [];
      return [{title:typeof r.title==='string' ? r.title.slice(0,300):url.hostname,url:url.href}];
    } catch {return [];}
  }).slice(0,20);
}
function result(text:unknown,refs:unknown,source:AIResult['source']):AIResult {
  if(typeof text!=='string' || !text.trim() || text.length>20000)throw new ApiError(502,'LINER_INVALID_RESPONSE');
  const list=citations(refs);
  return {text,citations:list,source,simulated:source==='mock',cached:false,reviewRequired:true,sourceMissing:list.length===0};
}
// Parse the documented SSE envelope, not merely HTTP 200 / [DONE].
// Partial text is discarded on any error or missing terminal markers.
export function parseSearchSse(text:string):AIResult {
  let answer='', finished=false, done=false;
  const refs:unknown[]=[];
  for(const frame of text.replace(/\r\n/g,'\n').split('\n\n')) {
    const data=frame.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
    if(!data)continue;
    if(done)throw new ApiError(502,'LINER_INVALID_RESPONSE');
    if(data==='[DONE]'){done=true;continue;}
    const event=record(parseJson(data));
    if(event.type==='data-error' || event.type==='error' || event.error)throw new ApiError(502,'LINER_STREAM_ERROR');
    if(event.type==='text-delta') {
      if(finished || typeof event.delta!=='string')throw new ApiError(502,'LINER_INVALID_RESPONSE');
      answer+=event.delta;
    }
    if(event.type==='data-search-references') {
      const references=record(event.data).references;
      if(!Array.isArray(references))throw new ApiError(502,'LINER_INVALID_RESPONSE');
      refs.push(...references);
    }
    if(event.type==='finish')finished=true;
  }
  if(!done || !finished)throw new ApiError(502,'LINER_INCOMPLETE_STREAM');
  return result(answer,refs,'search');
}
export class LinerService {
  private limiter=new LinerLimiter();
  private cache=new SimpleCache();
  private pending=new Map<string,Promise<AIResult>>();
  constructor(private readonly cfg:Config,private readonly fetcher:Fetch=fetch) {}
  private async call(path:string,body:unknown) {
    const deadline=performance.now()+this.cfg.upstreamTimeoutMs;
    await this.limiter.wait(deadline);
    const remaining=deadline-performance.now();
    if(remaining<=0)throw new ApiError(504,'LINER_TIMEOUT');
    return upstream(this.fetcher,'https://platform.liner.com'+path,{'x-api-key':this.cfg.linerKey},
      'POST',body,remaining,'LINER');
  }
  private async draft(task:string,prompt:string):Promise<AIResult> {
    if(this.cfg.linerMode==='mock')return result('[모의 초안] '+task+' 안내 문구입니다. 실제 생성 결과가 아니며 영양사의 검토와 승인이 필요합니다.',[],'mock');
    const response=await this.call('/api/v1/chat/completions',{
      model:this.cfg.linerModel,stream:false,
      messages:[
        {role:'system',content:'학교급식 일반 안내문 초안만 간결한 한국어로 작성하세요. 질병의 치료 효과, 알레르기 안전성, 제공되지 않은 수치와 학생 정보를 추정하지 마세요.'},
        {role:'user',content:prompt},
      ],
    });
    const data=record(parseJson(response.text));
    if(data.error || !Array.isArray(data.choices))throw new ApiError(502,'LINER_INVALID_RESPONSE');
    const choice=record(data.choices[0]);
    if(choice.finish_reason!=='stop')throw new ApiError(502,'LINER_INCOMPLETE_RESPONSE');
    return result(record(choice.message).content,[],'router');
  }
  private async search(query:string):Promise<AIResult> {
    if(this.cfg.linerMode==='mock')return result('[모의 검색] 실제 근거와 출처가 없습니다. 연결 후 다시 검색하고 원재료와 출처를 확인하세요.',[],'mock');
    const response=await this.call('/api/v1/agents/search',{messages:[{role:'user',content:query}],lang:'ko',mode:'general',stream:true});
    if(!response.contentType.toLowerCase().includes('text/event-stream'))throw new ApiError(502,'LINER_INVALID_RESPONSE');
    return parseSearchSse(response.text);
  }
  s2News(input:NewsInput):Promise<AIResult> {
    return this.cached('s2',input,()=>this.draft('월간 급식 소식',input.month+' 대표 메뉴: '+input.menus.join(', ')+'. 일반 급식 소식 한 문단. 영양량을 추정하지 마세요.'));
  }
  nutrition(input:NutritionInput):Promise<AIResult> {
    return this.cached('nutrition',input,()=>this.search(topicMap[input.topicId]+'의 일반 정보와 공신력 있는 출처. 의료적 효능을 단정하지 마세요.'));
  }
  substituteEvidence(input:EvidenceInput):Promise<AIResult> {
    return this.cached('evidence',input,()=>this.search(allergens[input.allergenNo]+' 알레르기 '+input.foodName+' 대체 식품 일반 정보와 출처. 특정 학생의 안전 판정을 하지 마세요. 제품 원재료와 교차오염은 별도 확인해야 합니다.'));
  }
  s5(input:S5Input):Promise<AIResult> {
    return this.cached('s5',input,()=>this.draft('운영현황 보고','집계: '+JSON.stringify(input.counts)+'. 중립적인 운영 보고 한 문단. 3명 미만인 숫자를 추정하지 마세요.'));
  }
  private async cached(prefix:string,input:unknown,run:()=>Promise<AIResult>):Promise<AIResult> {
    const key=createHash('sha256').update(JSON.stringify({prefix,input})).digest('hex');
    const cached=this.cache.get(key) as AIResult|undefined;
    if(cached)return {...cached,cached:true};
    const pending=this.pending.get(key);
    if(pending)return {...await pending,cached:true};
    if(this.pending.size>=32)throw new ApiError(429,'RELAY_BUSY');
    const promise=run().then(value=>{
      // Never echo server credentials, including malicious/upstream diagnostic output.
      const responseFields = [value.text, ...value.citations.flatMap(({title,url}) => [title,url])];
      if([this.cfg.linerKey,this.cfg.channelKey,this.cfg.channelSecret,this.cfg.relayAuthToken]
        .some(secret => secret && responseFields.some(field => field.includes(secret))))
        throw new ApiError(502,'UPSTREAM_INVALID_RESPONSE');
      this.cache.set(key,value);return value;
    });
    this.pending.set(key,promise);
    try {return await promise;} finally {this.pending.delete(key);}
  }
}
