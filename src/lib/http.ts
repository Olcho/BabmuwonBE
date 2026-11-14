import type { IncomingMessage,ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { ApiError } from './errors.js';
import type { Config } from '../config.js';

export function reply(res:ServerResponse,status:number,value:unknown):void {
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(JSON.stringify(value));
}
export function jsonBody(req:IncomingMessage):Promise<unknown> {
  if(!/^application\/json(?:\s*;.*)?$/i.test(req.headers['content-type']??''))throw new ApiError(415,'JSON_REQUIRED');
  return new Promise((resolve,reject)=>{
    let size=0, settled=false; const parts:Buffer[]=[];
    const fail=(error:ApiError)=>{if(!settled){settled=true;parts.length=0;reject(error);}};
    req.on('data',(chunk:Buffer)=>{
      if(settled)return;
      size+=chunk.length;
      if(size>16*1024){fail(new ApiError(413,'PAYLOAD_TOO_LARGE'));return;}
      parts.push(chunk);
    });
    req.on('end',()=>{
      if(settled)return; settled=true;
      try {resolve(JSON.parse(Buffer.concat(parts).toString('utf8')));}
      catch {reject(new ApiError(400,'INVALID_JSON'));}
    });
    req.on('error',()=>fail(new ApiError(400,'INVALID_REQUEST')));
    req.on('aborted',()=>fail(new ApiError(400,'INVALID_REQUEST')));
  });
}
export function authorize(req:IncomingMessage,config:Config):void {
  const match=/^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(req.headers.authorization??'');
  const a=Buffer.from(match?.[1]??''), b=Buffer.from(config.relayAuthToken);
  if(a.length!==b.length || !timingSafeEqual(a,b))throw new ApiError(401,'UNAUTHORIZED');
}
export function cors(req:IncomingMessage,res:ServerResponse,config:Config):void {
  if(!/^(localhost|127\.0\.0\.1)(:[0-9]{1,5})?$/.test(req.headers.host??''))throw new ApiError(403,'HOST_NOT_ALLOWED');
  const origin=req.headers.origin;
  if(origin) {
    if(!config.allowedOrigins.includes(origin))throw new ApiError(403,'ORIGIN_NOT_ALLOWED');
    res.setHeader('access-control-allow-origin',origin);
    res.setHeader('vary','Origin');
    res.setHeader('access-control-allow-methods','GET,POST,OPTIONS');
    res.setHeader('access-control-allow-headers','Authorization,Content-Type');
  }
}
