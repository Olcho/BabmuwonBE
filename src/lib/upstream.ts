import { ApiError } from './errors.js';

export type Fetch = typeof fetch;
export async function boundedText(response:Response):Promise<string> {
  if(!response.body)throw new ApiError(502,'UPSTREAM_INVALID_RESPONSE');
  const reader=response.body.getReader(), decoder=new TextDecoder();
  let bytes=0, text='';
  try {
    while(true) {
      const {done,value}=await reader.read(); if(done)break;
      bytes+=value.byteLength;
      if(bytes>1024*1024)throw new ApiError(502,'UPSTREAM_RESPONSE_TOO_LARGE');
      text+=decoder.decode(value,{stream:true});
    }
    return text+decoder.decode();
  } finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
}
export async function upstream(
  fetcher:Fetch, url:string, headers:Record<string,string>, method:string, body:unknown,
  timeoutMs:number, provider:'LINER'|'CHANNEL',
):Promise<{text:string;contentType:string}> {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const response=await fetcher(url,{method,headers:{...headers,'content-type':'application/json'},
      body:JSON.stringify(body),signal:controller.signal,redirect:'error'});
    if(!response.ok) {
      await response.body?.cancel();
      const code=response.status===429?'RATE_LIMITED':response.status===401||response.status===403?'AUTH_FAILED':'UPSTREAM_ERROR';
      throw new ApiError(response.status===429?503:502,provider+'_'+code);
    }
    return {text:await boundedText(response),contentType:response.headers.get('content-type')??''};
  } catch(e) {
    if(e instanceof ApiError)throw e;
    throw new ApiError(controller.signal.aborted?504:502,provider+(controller.signal.aborted?'_TIMEOUT':'_UPSTREAM_ERROR'));
  } finally { clearTimeout(timer); }
}
export function parseJson(text:string):unknown {
  try { return JSON.parse(text); } catch { throw new ApiError(502,'UPSTREAM_INVALID_RESPONSE'); }
}
export function record(value:unknown):Record<string,unknown> {
  if(!value || typeof value!=='object' || Array.isArray(value))throw new ApiError(502,'UPSTREAM_INVALID_RESPONSE');
  return value as Record<string,unknown>;
}
