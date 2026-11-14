export class LinerLimiter {
  private last=0;
  private tail:Promise<void>=Promise.resolve();
  async wait():Promise<void>{
    let release!:()=>void;
    const previous=this.tail;
    this.tail=new Promise(resolve=>{release=resolve;});
    await previous;
    const pause=Math.max(0,550-(Date.now()-this.last));
    if(pause)await new Promise(r=>setTimeout(r,pause));
    this.last=Date.now();release();
  }
}
export class SimpleCache {
  private entries=new Map<string,{value:unknown;expires:number}>();
  get(key:string):unknown|undefined {
    const val=this.entries.get(key);
    if(!val)return undefined;
    if(Date.now()>val.expires){this.entries.delete(key);return undefined;}
    return val.value;
  }
  set(key:string,value:unknown,ttlMs=60*60*1000):void {
    if(this.entries.size>=100)this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key,{value,expires:Date.now()+ttlMs});
  }
}
