import { setTimeout as delay } from 'node:timers/promises';
import { ApiError } from './errors.js';

export class LinerLimiter {
  private lastStart = -Infinity;
  private tail: Promise<void> = Promise.resolve();

  async wait(deadline = Infinity): Promise<void> {
    const timeout = () => new ApiError(504, 'LINER_TIMEOUT');
    const slot = this.tail.then(async () => {
      const earliestStart = Math.max(performance.now(), this.lastStart + 550);
      if (earliestStart >= deadline) throw timeout();
      const waitMs = Math.ceil(earliestStart - performance.now());
      if (waitMs > 0) await delay(waitMs);
      if (performance.now() >= deadline) throw timeout();
      this.lastStart = performance.now();
    });
    this.tail = slot.catch(() => {});

    if (!Number.isFinite(deadline)) return slot;
    // An expired caller can return while earlier calls still hold the queue.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        slot,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(timeout()), Math.ceil(deadline - performance.now()));
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
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
