import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { randomTestConfig } from '../dist/config.js';
import { LinerService } from '../dist/providers/liner.js';
import { citationWarnings, matchSearchCitations } from '../dist/lib/search-citations.js';
import baselineMessages from './liner-quality-baseline.json' with {type:'json'};

// Fixture URLs are compared as strings. The tool never fetches these pages.
const nutritionSource = {title:'학교급식 자료 모의 원문',url:'https://fixtures.mawd-demo.kr/school-meals'};
const allergySource = {title:'알레르기 자료 모의 원문',url:'https://fixtures.mawd-demo.kr/allergens'};
const news = {month:'2026-12',menus:['들깨무국','사과(조각)','현미밥']};
const nutrition = {topicId:'balanced_meals'};
const evidence = {allergenNo:1,foodName:'달걀찜'};
const report = {counts:{byAllergen:[{allergenNo:1,students:7},{allergenNo:5,students:4}],
  byGrade:[{grade:2,students:5}],provided:8,excluded:'3명 미만'}};

export const cases = [
  {method:'s2News',input:news,
    text:'12월 급식에서는 들깨무국과 현미밥을 만나고 사과(조각)도 맛볼 수 있습니다. 집에서 오늘 먹은 급식 중 무엇이 기억에 남았는지 아이와 이야기해 보세요.'},
  {method:'nutrition',input:nutrition,
    text:'급식에서 다양한 음식을 골고루 먹고, 집에서는 오늘 먹은 채소를 함께 떠올려 보세요. '+nutritionSource.title+' '+nutritionSource.url,
    citations:[nutritionSource]},
  {method:'substituteEvidence',input:evidence,
    text:'대체 후보로 두부 요리를 검토할 수 있습니다. 원재료, 교차오염, 대두 등 다른 알레르기 유발 식품을 확인하세요. 확인 전에는 특정 학생에 대한 안전 판정을 할 수 없습니다. '+allergySource.title+' '+allergySource.url,
    citations:[allergySource]},
  {method:'s5',input:report,
    text:'제공 8명, 제외 3명 미만으로 집계되었습니다. 알레르기 항목별로 난류 7명, 대두 4명이었고, 학년별 집계에서 2학년은 5명이었습니다.'},
];

const calorie = /\d[\d,.\s]*(?:kcal\b|㎉|킬로\s*칼로리|칼로리)/iu;
const personCount = /\d[\d,]*\s*명(?:\s*미만)?/gu;
const otherAllergens = /(?:다른|기타|그\s*밖의|추가(?:적인)?)\s*알레르기(?:\s*유발\s*(?:식품|물질))?/u;

function hasForeignProse(text,citations) {
  const prose = citations.reduce((body,{title})=>title ? body.replaceAll(title,'') : body,text)
    .replace(/https?:\/\/[^\s<>)]+/gu,'')
    .replace(/\b(?:kcal|HACCP|FAQ|PDF|KDRIs?|URL)\b/giu,'');
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Cyrillic}\p{Script=Arabic}]+/u.test(prose)
    || /(?:\b[A-Za-z]+[ \t]+){2,}[A-Za-z]+\b/u.test(prose);
}

// These checks cover the fixed fixtures only. Semantic support and tone need a reviewer.
export function qualityIssues(scenario, {text, citations, sourceMissing}) {
  const issues = [];
  if (scenario.method === 's2News') {
    const exactMenus = scenario.input.menus.every(menu => text.includes(menu));
    if (!exactMenus) issues.push('menu_missing_or_changed');
    const [year, month] = scenario.input.month.split('-');
    const otherNumbers = text.replaceAll(scenario.input.month, '').replaceAll(`${year}년`, '')
      .replaceAll(`${Number(month)}월`, '');
    if (/\d/u.test(otherNumbers)) issues.push('unprovided_number');
  }
  if (scenario.method === 'nutrition' && calorie.test(text.replace(/https?:\/\/[^\s<>)]+/gu,''))) {
    issues.push('unscoped_energy_standard');
  }
  if (scenario.method === 'substituteEvidence') {
    if (/(?:안전합니다|안전하므로|안전을 보장합니다|먹어도 됩니다|안심하고 제공)/u.test(text)) {
      issues.push('unsupported_safety_claim');
    }
    if (!/원\s*재료|성분\s*표시/u.test(text) || !/교차\s*오염|교차\s*접촉/u.test(text) || !otherAllergens.test(text)) {
      issues.push('missing_safety_check');
    }
  }
  if (scenario.method === 's5') {
    if (!/3\s*명\s*미만/u.test(text) || /(?<![\d,])(?:[012]|한|두|영|제로)\s*명/u.test(text)) {
      issues.push('suppressed_count_reconstructed');
    }
    const {byAllergen,byGrade=[],provided,excluded} = scenario.input.counts;
    const expected = [provided,excluded,...byAllergen.map(item=>item.students),...byGrade.map(item=>item.students)]
      .map(value=>typeof value==='number'?`${value}명`:value.replaceAll(' ',''));
    const numbers = (text.match(personCount) ?? []).map(value=>value.replace(/[,\s]/gu,''));
    let unexpectedCount = false;
    for (const number of numbers) {
      const index = expected.indexOf(number);
      if (index < 0) unexpectedCount = true;
      else expected.splice(index,1);
    }
    if (unexpectedCount) issues.push('unprovided_count');
    if (expected.length) issues.push('count_not_preserved');
    // Check common label-first clauses for this fixture, even when counts still have the same multiset.
    const labeledCounts = [
      [/제공(?:\s*인원)?/u,provided], [/제외(?:\s*인원)?/u,excluded],
      [/난류|달걀/u,byAllergen.find(item=>item.allergenNo===1)?.students],
      [/대두|콩/u,byAllergen.find(item=>item.allergenNo===5)?.students],
      [/2\s*학년/u,byGrade.find(item=>item.grade===2)?.students],
    ];
    for (const [label,value] of labeledCounts) {
      const actual = text.match(new RegExp(`(?:${label.source})\\s*(?:은|는|이|가|:)?\\s*(\\d[\\d,]*\\s*명(?:\\s*미만)?)`,'u'))?.[1];
      const expectedCount = typeof value === 'number' ? `${value}명` : value?.replaceAll(' ','');
      if (actual && expectedCount && actual.replace(/[,\s]/gu,'') !== expectedCount) {
        issues.push('count_assigned_to_wrong_label');
        break;
      }
    }
    if (!/난류|달걀/u.test(text) || !/대두|콩/u.test(text) || /알레르기\s*(?:항목\s*)?(?:번호\s*)?\d+\s*번/u.test(text)) {
      issues.push('allergen_name_missing');
    }
  }
  if (scenario.citations) {
    const checked = matchSearchCitations(text,citations,[]);
    for (const [code,label] of Object.entries(citationWarnings)) {
      if (checked.text.includes(`〔${label}〕`)) issues.push(code);
    }
    if ((sourceMissing || checked.sourceMissing) && !issues.includes('citation_unlinked')) issues.push('citation_unlinked');
    if (hasForeignProse(text,citations)) issues.push('foreign_prose');
  }
  return issues;
}

function fixtureResponse(scenario) {
  if (!scenario.citations) {
    return Response.json({choices:[{finish_reason:'stop',message:{content:scenario.text}}]});
  }
  const events = [
    {type:'data-search-references',data:{references:scenario.citations}},
    {type:'text-delta',delta:scenario.text},
    {type:'finish'},
  ];
  const body = events.map(event => 'data: '+JSON.stringify(event)+'\n\n').join('')+'data: [DONE]\n\n';
  return new Response(body,{headers:{'content-type':'text/event-stream'}});
}

export async function comparePrompts({apiKey, pairs=1, observeRequest} = {}) {
  const rows = [];
  let nextCall = 0;
  for (let pair=0; pair<pairs; pair++) {
    for (const scenario of cases) {
      const order = pair % 2 === 0 ? ['baseline','improved'] : ['improved','baseline'];
      for (const variant of order) {
        let adapterCalls = 0, externalCalls = 0;
        const provider = new LinerService({...randomTestConfig('unused'),linerMode:'live',linerKey:apiKey ?? 'fixture-key'},
          async (url, init) => {
            adapterCalls++;
            const request = JSON.parse(init.body);
            if (variant === 'baseline') request.messages = structuredClone(baselineMessages[scenario.method]);
            observeRequest?.({variant,scenario,request});
            if (!apiKey) return fixtureResponse(scenario);
            externalCalls++;
            nextCall = performance.now()+550;
            return fetch(url,{...init,body:JSON.stringify(request)});
          });
        if (apiKey) await delay(Math.max(0,nextCall-performance.now()));
        const start = performance.now();
        const row = {pair:pair+1,method:scenario.method,variant};
        try {
          const result = await provider[scenario.method](scenario.input);
          Object.assign(row,{issues:qualityIssues(scenario,result),text:result.text,citations:result.citations,
            sourceMissing:result.sourceMissing,reviewRequired:result.reviewRequired});
          if (scenario.citations) row.claimSupport = 'manual_review';
        } catch (error) {
          row.error = error?.code ?? 'QUALITY_RUN_FAILED';
        }
        rows.push({...row,elapsedMs:Number((performance.now()-start).toFixed(2)),adapterCalls,externalCalls});
      }
    }
  }
  return rows;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const live = process.argv[2] === '--live';
  const pairs = Number(process.argv[live ? 3 : 2] ?? 1);
  if (!Number.isInteger(pairs) || pairs < 1 || pairs > 5 || process.argv.length > (live ? 4 : 3)) {
    throw new Error('Usage: node tools/liner-quality.mjs [--live] [pairs: 1-5]');
  }
  const apiKey = live ? process.env.LINER_API_KEY?.trim() : undefined;
  if (live && !apiKey) throw new Error('LINER_API_KEY environment variable required with --live');
  const rows = await comparePrompts({apiKey,pairs});
  console.log(JSON.stringify({mode:live?'live':'fixture',node:process.version,rows},null,2));
  if (rows.some(row => row.error)) process.exitCode = 1;
}
