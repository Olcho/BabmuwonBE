import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, openSync, closeSync, fsyncSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ApiError } from './errors.js';
import { validateDocument, type DocumentState } from './validation.js';

export type RequestStatus = 'pending' | 'requested' | 'request_failed';
export const MAX_SEND_RETRIES = 3;
export type Stage = 'reserved' | 'upsert' | 'event' | 'requested' | 'upsert_failed' | 'uncertain' | 'manual';
export interface Attempt { at:string; finishedAt?:string; stage:Stage; errorCode?:string }
export interface RecipientState {
  memberId:string; phoneProof:string; requestStatus:RequestStatus;
  deliveryStatus:'unknown'; retryCount:number; retryable:boolean; stage:Stage;
  updatedAt:string; errorCode?:string; attempts:Attempt[];
}
export interface Batch {
  batchKey:string; month:string; docVersion:number; templateCode:string; simulated:boolean;
  status:'requesting'|'requested'|'partial'|'manual'; createdAt:string; recipients:RecipientState[];
}
interface DB { version:2; batches:Record<string,Batch>; documents:Record<string,DocumentState> }
const stages:Stage[]=['reserved','upsert','event','requested','upsert_failed','uncertain','manual'];
const now=()=>new Date().toISOString();

export class StateStore {
  private state:DB={version:2,batches:{},documents:{}};
  private lockOwner=randomUUID();
  private released=false;
  private poisoned=false;
  constructor(private readonly file:string) {
    mkdirSync(dirname(file),{recursive:true});
    this.acquire();
    try {
      if(existsSync(file)) {
        const db=JSON.parse(readFileSync(file,'utf8')) as DB;
        if(db.version!==2 || !db.batches || !db.documents || typeof db.batches!=='object'
          || typeof db.documents!=='object' || Array.isArray(db.batches) || Array.isArray(db.documents)) throw new Error();
        for(const [key,d] of Object.entries(db.documents)) if(validateDocument(d).month!==key) throw new Error();
        for(const [key,b] of Object.entries(db.batches)) {
          if(!b || b.batchKey!==key || !/^20\d{2}-(0[1-9]|1[0-2]):doc-v[1-9]\d{0,8}:[A-Za-z0-9_-]{1,64}$/.test(key)
            || key!==b.month+':doc-v'+b.docVersion+':'+b.templateCode
            || typeof b.simulated!=='boolean' || !Array.isArray(b.recipients) || !b.recipients.length
            || !['requesting','requested','partial','manual'].includes(b.status)) throw new Error();
          for(const r of b.recipients) if(!r || !stages.includes(r.stage)
            || !['pending','requested','request_failed'].includes(r.requestStatus) || r.deliveryStatus!=='unknown'
            || !/^[0-9a-f-]{36}$/.test(r.memberId) || !/^[0-9a-f]{64}$/.test(r.phoneProof)
            || !Number.isInteger(r.retryCount) || r.retryCount<0 || r.retryCount>MAX_SEND_RETRIES
            || !Array.isArray(r.attempts) || !r.attempts.length || typeof r.retryable!=='boolean') throw new Error();
        }
        this.state=db;
      }
      // An interrupted upsert is safe to repeat; an event attempt may already have sent.
      const recovered=structuredClone(this.state);
      let changed=false;
      for(const b of Object.values(recovered.batches)) for(const r of b.recipients) {
        if(r.requestStatus==='pending' && r.stage!=='manual') {
          const uncertain=r.stage==='event';
          r.requestStatus='request_failed'; r.retryable=!uncertain;
          r.stage=uncertain?'uncertain':'upsert_failed';
          r.errorCode=uncertain?'EVENT_OUTCOME_UNKNOWN':'INTERRUPTED_BEFORE_EVENT';
          r.updatedAt=now();
          Object.assign(r.attempts.at(-1)!,{stage:r.stage,errorCode:r.errorCode,finishedAt:now()});
          changed=true;
        }
      }
      if(changed) this.commit(recovered);
    } catch { this.close(); throw new Error('STATE_FILE_INVALID_OR_UNWRITABLE'); }
  }
  private acquire():void {
    const path=this.file+'.lock';
    // Serialize even stale-lock recovery. Without this guard two starters could
    // delete each other's newly acquired lock after observing the same dead PID.
    const guard=path+'.guard';
    try { writeFileSync(guard,'lock acquisition in progress',{flag:'wx',mode:0o600}); }
    catch { throw new Error('STATE_LOCK_REQUIRES_INSPECTION'); }
    try {
    if(existsSync(path)) {
      try {
        const lock=JSON.parse(readFileSync(path,'utf8')) as {pid:number};
        if(!Number.isInteger(lock.pid)||lock.pid<1) throw new Error();
        try { process.kill(lock.pid,0); }
        catch(e) {
          if((e as NodeJS.ErrnoException).code==='ESRCH') unlinkSync(path);
          else throw e;
        }
      } catch { throw new Error('STATE_LOCK_REQUIRES_INSPECTION'); }
    }
    try { writeFileSync(path,JSON.stringify({pid:process.pid,owner:this.lockOwner}),{flag:'wx',mode:0o600}); }
    catch { throw new Error('STATE_IN_USE'); }
    } finally { unlinkSync(guard); }
  }
  close():void {
    if(this.released)return;
    this.released=true;
    try {
      const lock=JSON.parse(readFileSync(this.file+'.lock','utf8'));
      if(lock.owner===this.lockOwner) unlinkSync(this.file+'.lock');
    } catch { /* Leave an unverified lock in place. */ }
  }
  private commit(next:DB):void {
    if(this.poisoned)throw new ApiError(503,'STATE_UNAVAILABLE');
    for(const b of Object.values(next.batches)) {
      b.status=b.recipients.every(r=>r.stage==='manual')?'manual':
        b.recipients.some(r=>r.requestStatus==='pending' && r.stage!=='manual')?'requesting':
        b.recipients.every(r=>r.requestStatus==='requested')?'requested':'partial';
    }
    const temp=this.file+'.tmp';
    let fd:number|undefined;
    try {
      fd=openSync(temp,'w',0o600);
      writeFileSync(fd,JSON.stringify(next)); fsyncSync(fd); closeSync(fd); fd=undefined;
      renameSync(temp,this.file);
      this.state=next;
    } catch {
      // No further external side effects after a persistence failure.
      this.poisoned=true;
      throw new ApiError(503,'STATE_UNAVAILABLE');
    } finally { if(fd!==undefined)closeSync(fd); }
  }
  get(key:string):Batch|undefined {
    const b=Object.hasOwn(this.state.batches,key)?this.state.batches[key]:undefined;
    return b ? structuredClone(b):undefined;
  }
  create(batch:Batch):void {
    if(this.get(batch.batchKey) || Object.values(this.state.batches).some(b=>b.month===batch.month && b.docVersion===batch.docVersion))
      throw new ApiError(409,'DUPLICATE_BATCH');
    const next=structuredClone(this.state); next.batches[batch.batchKey]=batch; this.commit(next);
  }
  update(key:string,fn:(b:Batch)=>void):void {
    if(!this.get(key))throw new ApiError(404,'BATCH_NOT_FOUND');
    const next=structuredClone(this.state); fn(next.batches[key]); this.commit(next);
  }
  setDocument(d:DocumentState):void {
    const old=this.state.documents[d.month];
    if(old && (d.planVersion<old.planVersion || d.docVersion<old.docVersion)) throw new ApiError(409,'VERSION_REGRESSION');
    if(old && d.docVersion===old.docVersion && d.basedOnPlanVersion!==old.basedOnPlanVersion) throw new ApiError(409,'NEW_DOCUMENT_VERSION_REQUIRED');
    const next=structuredClone(this.state); next.documents[d.month]=d; this.commit(next);
  }
  assertApproved(month:string,docVersion:number):void {
    const d=this.state.documents[month];
    if(!d || !d.approved || !d.planConfirmed || d.docVersion!==docVersion || d.planVersion!==d.basedOnPlanVersion)
      throw new ApiError(409,'S2_NOT_CURRENT_APPROVED');
  }
  publicView(key:string) {
    const b=this.get(key); if(!b)throw new ApiError(404,'BATCH_NOT_FOUND');
    const d=this.state.documents[b.month];
    const correctionNeeded=!!d && (!d.approved || !d.planConfirmed || d.docVersion!==b.docVersion || d.basedOnPlanVersion!==d.planVersion);
    return {
      batchKey:b.batchKey,month:b.month,simulated:b.simulated,status:b.status,createdAt:b.createdAt,correctionNeeded,
      recipients:b.recipients.map(({phoneProof:_,...r})=>({
        ...r, retryable: r.retryable && r.retryCount < MAX_SEND_RETRIES,
      })),
      totals:{count:b.recipients.length,requested:b.recipients.filter(r=>r.requestStatus==='requested').length,
        failed:b.recipients.filter(r=>r.requestStatus==='request_failed').length,
        uncertain:b.recipients.filter(r=>r.stage==='uncertain').length,delivered:0},
    };
  }
}
