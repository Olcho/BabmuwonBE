import { blocked, invalid } from './errors.js';

export type ObjectValue = Record<string, unknown>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const monthRe = /^20\d{2}-(0[1-9]|1[0-2])$/;
const phoneRe = /^010\d{8}$/;
function obj(v: unknown, expectedKeys: string[], requiredKeys = expectedKeys): ObjectValue {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw invalid();
  const o = v as ObjectValue;
  if (Object.keys(o).some(k=>!expectedKeys.includes(k))) throw invalid();
  if (requiredKeys.some(k=>!Object.hasOwn(o,k))) throw invalid();
  return o;
}
function str(v: unknown, min = 1, max = 50): string {
  if (typeof v !== 'string' || v.trim().length < min || v.length > max) throw invalid();
  return v.trim();
}
function month(v: unknown): string {
  const s = str(v, 7, 7); if (!monthRe.test(s)) throw invalid(); return s;
}
function menuName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || [...value].length > 200) throw invalid();
  return value;
}
export const topicMap: Record<string, string> = {
  balanced_meals: '학교급식 균형 잡힌 식사와 식생활 실천',
  seasonal_foods: '제철 식재료와 건강한 식습관',
  food_allergy_basics: '학교급식 식품 알레르기 표시의 의미와 유의사항',
  winter_nutrition: '겨울철 어린이 청소년 건강한 식습관',
  food_waste: '학교급식 음식물 쓰레기 줄이기와 올바른 식습관'
};
export type NewsInput = {month:string; menus:string[]};
export type NutritionInput = {topicId:string};
export type EvidenceInput = {allergenNo:number;foodName:string};
export type SafeCount = number | '3명 미만';
export type S5Input = {counts:{byAllergen:{allergenNo:number;students:SafeCount}[];byGrade?:{grade:number;students:SafeCount}[];provided:SafeCount;excluded:SafeCount}};
export type Recipient = {memberId:string;phone:string};
export type SendInput = {batchKey:string;month:string;docVersion:number;templateCode:string;recipients:Recipient[]};

export function validateNews(v:unknown):NewsInput {
  const o=obj(v,['month','menus']);
  if (!Array.isArray(o.menus) || o.menus.length < 1 || o.menus.length > 3) throw invalid();
  return {month:month(o.month),menus:o.menus.map(menuName)};
}
export function validateNutrition(v:unknown):NutritionInput {
  const o=obj(v,['topicId']);const topicId=str(o.topicId);
  if (!Object.hasOwn(topicMap,topicId)) throw invalid();return {topicId};
}
export function validateEvidence(v:unknown):EvidenceInput {
  const o=obj(v,['allergenNo','foodName']);const allergenNo=o.allergenNo;
  if (typeof allergenNo!=='number' || !Number.isInteger(allergenNo) || allergenNo<1 || allergenNo>19) throw invalid();
  return {allergenNo,foodName:menuName(o.foodName)};
}
function safeCount(v:unknown):SafeCount {
  if (v==='3명 미만') return v;
  if (typeof v!=='number' || !Number.isSafeInteger(v) || v<3 || v>100000) throw blocked();
  return v;
}
export function validateS5(v:unknown):S5Input {
  const o=obj(v,['counts']);const c=obj(o.counts,['byAllergen','byGrade','provided','excluded'],['byAllergen','provided','excluded']);
  if (!Array.isArray(c.byAllergen)||c.byAllergen.length>19) throw invalid();
  const seen = new Set<number>();
  const byAllergen=c.byAllergen.map(item=>{
    const r=obj(item,['allergenNo','students']);
    if (typeof r.allergenNo!=='number'||!Number.isInteger(r.allergenNo)||r.allergenNo<1||r.allergenNo>19||seen.has(r.allergenNo)) throw invalid();
    seen.add(r.allergenNo);
    return {allergenNo:r.allergenNo,students:safeCount(r.students)};
  });
  let byGrade:S5Input['counts']['byGrade'];
  if (Object.hasOwn(c,'byGrade')) {
    if (!Array.isArray(c.byGrade)||c.byGrade.length>6) throw invalid();
    const grades=new Set<number>();
    byGrade=c.byGrade.map(item=>{
      const r=obj(item,['grade','students']);
      if(typeof r.grade!=='number'||!Number.isInteger(r.grade)||r.grade<1||r.grade>6||grades.has(r.grade))throw invalid();
      grades.add(r.grade);
      return {grade:r.grade,students:safeCount(r.students)};
    });
  }
  return {counts:{byAllergen,...(byGrade?{byGrade}:{}),provided:safeCount(c.provided),excluded:safeCount(c.excluded)}};
}
export function validateSend(v:unknown):SendInput {
  const o=obj(v,['batchKey','month','recipients']);
  const m=month(o.month);
  const batchKey=str(o.batchKey, 10, 120);
  const match = /^(20\d{2}-(?:0[1-9]|1[0-2])):doc-v([1-9]\d{0,8}):([A-Za-z0-9_-]{1,64})$/.exec(batchKey);
  if (!match || match[1] !== m) throw invalid();
  if (!Array.isArray(o.recipients)||o.recipients.length<1||o.recipients.length>10) throw invalid(); // 해커톤 데모 전용
  const seenId=new Set<string>(),seenPhone=new Set<string>();
  const recipients=o.recipients.map(v=>{
    const r=obj(v,['memberId','phone']);
    const memberId=str(r.memberId).toLowerCase(), rawPhone=str(r.phone);
    if (!/^010(?:\d{8}|-\d{4}-\d{4})$/.test(rawPhone)) throw invalid();
    const phone=rawPhone.replace(/-/g,'');
    if (!uuid.test(memberId)||!phoneRe.test(phone)||seenId.has(memberId)||seenPhone.has(phone)) throw invalid();
    seenId.add(memberId);seenPhone.add(phone);return {memberId,phone};
  });
  return {batchKey,month:m,docVersion:Number(match[2]),templateCode:match[3],recipients};
}

export interface DocumentState {
  month:string; planVersion:number; planConfirmed:boolean; docVersion:number;
  basedOnPlanVersion:number; approved:boolean;
}
export function validateDocument(v:unknown):DocumentState {
  const o=obj(v,['month','planVersion','planConfirmed','docVersion','basedOnPlanVersion','approved']);
  for (const key of ['planVersion','docVersion','basedOnPlanVersion']) {
    if (typeof o[key]!=='number' || !Number.isSafeInteger(o[key]) || (o[key] as number)<1 || (o[key] as number)>999999999) throw invalid();
  }
  if (typeof o.planConfirmed!=='boolean' || typeof o.approved!=='boolean') throw invalid();
  if ((o.basedOnPlanVersion as number)>(o.planVersion as number)) throw invalid();
  if (o.approved && (!o.planConfirmed || o.planVersion!==o.basedOnPlanVersion)) throw invalid();
  return {...o,month:month(o.month)} as unknown as DocumentState;
}
