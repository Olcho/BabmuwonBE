import type { Config } from '../config.js';
import { ApiError } from '../lib/errors.js';
import type { Recipient } from '../lib/validation.js';
import { upstream,parseJson,record,type Fetch } from '../lib/upstream.js';

export interface ChannelProvider {
  upsert(recipient:Recipient):Promise<string>;
  trigger(userId:string,month:string):Promise<void>;
}
export class ChannelService implements ChannelProvider {
  constructor(private readonly cfg:Config, private readonly fetcher:Fetch=fetch) {}
  private async request(path:string,method:'PUT'|'POST',body:unknown):Promise<unknown> {
    if(this.cfg.channelMode!=='live' || !this.cfg.realSendEnabled)throw new ApiError(503,'CHANNEL_SEND_DISABLED');
    const response=await upstream(this.fetcher,'https://api.channel.io/open/v5'+path,
      {'x-access-key':this.cfg.channelKey,'x-access-secret':this.cfg.channelSecret},
      method,body,this.cfg.upstreamTimeoutMs,'CHANNEL');
    return parseJson(response.text);
  }
  async upsert(recipient:Recipient):Promise<string> {
    if(this.cfg.channelMode==='mock')return 'mock-user-'+recipient.memberId;
    const data=record(await this.request('/users/@'+encodeURIComponent(recipient.memberId),'PUT',{
      profile:{mobileNumber:'+82'+recipient.phone.slice(1)},
    }));
    const user=record(data.user);
    if(typeof user.id!=='string' || !/^[A-Za-z0-9_-]{1,128}$/.test(user.id))throw new ApiError(502,'CHANNEL_INVALID_RESPONSE');
    return user.id;
  }
  async trigger(userId:string,month:string):Promise<void> {
    if(this.cfg.channelMode==='mock')return;
    const data=record(await this.request('/users/'+encodeURIComponent(userId)+'/events','POST',{
      name:'lunch_notice_requested',property:{month:String(Number(month.slice(5)))},
    }));
    // A 2xx without a recognizable Event is uncertain, never a delivery receipt.
    const event=record(data.event);
    if(typeof event.id!=='string' || !event.id || event.name!=='lunch_notice_requested' || event.userId!==userId)
      throw new ApiError(502,'CHANNEL_EVENT_RESPONSE_UNVERIFIED');
  }
}
