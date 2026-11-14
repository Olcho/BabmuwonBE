export interface AuditEvent { at:string; endpoint:string; status:string; statusCode:number; durationMs:number; diagnostic?:string }
export class AuditStore {
  private events:AuditEvent[]=[];
  add(endpoint:string,status:string,durationMs:number,statusCode:number,diagnostic?:string):void {
    this.events.push({at:new Date().toISOString(),endpoint,status,statusCode,durationMs,diagnostic});
    if(this.events.length>100)this.events.shift();
  }
  list():AuditEvent[]{return [...this.events].reverse();}
}
