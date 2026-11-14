import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cases, comparePrompts, qualityIssues } from './liner-quality.mjs';
import baselineMessages from './liner-quality-baseline.json' with {type:'json'};

test('quality rubric flags controlled examples of each requested failure', () => {
  const [news, nutrition, evidence, report] = cases;
  const failures = [
    [news,news.text.replace('사과(조각)','사과'),'menu_missing_or_changed'],
    [news,news.text.replace('들깨무국과 ',''),'menu_missing_or_changed'],
    [news,news.text+' 12일에 500kcal로 제공합니다.','unprovided_number'],
    [nutrition,'학교급식은 모두 400kcal가 기준입니다. '+nutrition.text,'unscoped_energy_standard'],
    [evidence,evidence.text+' 이 후보는 해당 학생이 먹어도 됩니다.','unsupported_safety_claim'],
    [evidence,evidence.text.replace('교차오염, ',''),'missing_safety_check'],
    [report,report.text.replace('3명 미만','2명'),'suppressed_count_reconstructed'],
    [report,report.text+' 두 항목 합계는 11명입니다.','unprovided_count'],
    [report,report.text.replace('대두 4명이었고, ',''),'count_not_preserved'],
    [report,report.text.replace('난류 7명, 대두 4명','난류 4명, 대두 7명'),'count_assigned_to_wrong_label'],
    [nutrition,'본문과 무관한 목록입니다.','citation_unlinked'],
    [nutrition,nutrition.text.replace('school-meals','unrelated'),'citation_unlinked'],
  ];
  for (const [scenario, text, issue] of failures) {
    assert.ok(qualityIssues(scenario,{text,citations:scenario.citations ?? []}).includes(issue),issue);
  }
});

test('quality rubric accepts common paraphrases and linked numeric citations and flags language and link defects', () => {
  const [,nutrition,evidence] = cases;
  const url = nutrition.citations[0].url;
  for (const phrase of ['기타 알레르기 유발 식품','그 밖의 알레르기 유발 물질','추가적인 알레르기 유발 식품']) {
    const text = evidence.text.replace('다른 알레르기 유발 식품',phrase)
      .replace('교차오염','교차 접촉').replace('원재료','성분 표시');
    assert.deepEqual(qualityIssues(evidence,{text,citations:evidence.citations}),[]);
  }
  assert.deepEqual(qualityIssues(nutrition,{text:`HACCP 자료에 따른 안내 [27](<${url}>)`,citations:nutrition.citations}),[]);
  for (const [text,issue] of [
    ['검토할 자료 [제목]()','empty_citation_url'],
    ['검토할 자료 [제목](https://example.com/page)','placeholder_citation_url'],
    ['근거 없는 번호 [27]','citation_unlinked'],
    [`급식 안내 [1](<${url}>) This sentence is not Korean.`, 'foreign_prose'],
    [`급식 안내 [1](<${url}>) 食生活を改善しましょう。`, 'foreign_prose'],
  ]) assert.ok(qualityIssues(nutrition,{text,citations:nutrition.citations}).includes(issue),issue);
  // Existence and URL agreement cannot decide if the cited page supports the claim.
  assert.deepEqual(qualityIssues(nutrition,{text:`달은 치즈로 이루어졌습니다. [1](<${url}>)`,citations:nutrition.citations}),[]);
});

test('A/B captures the current and frozen baseline prompts through all four provider methods offline', async () => {
  const requests = new Map();
  const rows = await comparePrompts({observeRequest:({variant,scenario,request}) => {
    requests.set(`${scenario.method}/${variant}`,request);
  }});
  assert.equal(rows.length,8);
  for (const row of rows) {
    assert.equal(row.error,undefined);
    assert.deepEqual(row.issues,[]);
    assert.equal(row.adapterCalls,1);
    assert.equal(row.externalCalls,0);
    if (row.method === 'nutrition' || row.method === 'substituteEvidence') {
      assert.equal(row.sourceMissing,false);
      assert.equal(row.reviewRequired,true);
      assert.equal(row.claimSupport,'manual_review');
    }
    assert.ok(Number.isFinite(row.elapsedMs) && row.elapsedMs >= 0);
  }
  const expectations = {
    s2News:['가정통신문','메뉴명을 모두 입력 표기 그대로','제공일·요일, 영양량, 식재료 구성'],
    nutrition:['자연스러운 한국어','국가법령정보센터','적용 대상과 시행일','특정 열량이나 영양량을 제시하지 마세요','문서명에 붙은 연도, 실제 발행일, 법령 시행일','이를 직접 뒷받침하는'],
    substituteEvidence:['특정 학생에게 안전하거나 제공 가능하다고 보장하지 마세요','원재료·복합원재료','교차오염','다른 알레르기 유발 식품','근거가 뒷받침하는 주장 바로 뒤'],
    s5:['인원수를 빠짐없이 해당 항목에 연결해 그대로','3명 미만','정확한 인원을 역산하거나 암시하지 마세요','임의로 합산하거나'],
  };
  for (const scenario of cases) {
    const baseline = requests.get(`${scenario.method}/baseline`);
    const improved = requests.get(`${scenario.method}/improved`);
    const prompt = improved.messages.at(-1).content;
    assert.deepEqual(baseline.messages,baselineMessages[scenario.method]);
    if (scenario.method !== 's2News') assert.notEqual(prompt,baseline.messages.at(-1).content);
    assert.deepEqual({...baseline,messages:null},{...improved,messages:null});
    for (const phrase of expectations[scenario.method]) assert.ok(prompt.includes(phrase),phrase);
    const data = prompt.split('\n입력 데이터: ')[1];
    switch (scenario.method) {
      case 's2News': assert.deepEqual(JSON.parse(data),scenario.input); break;
      case 'nutrition': assert.equal(prompt.split('\n')[0],'주제: 학교급식 균형 잡힌 식사와 식생활 실천'); break;
      case 'substituteEvidence': assert.deepEqual(JSON.parse(data),{allergen:'난류',foodName:scenario.input.foodName}); break;
      case 's5': assert.deepEqual(JSON.parse(data),{...scenario.input.counts,
        byAllergen:[{allergenName:'난류',students:7},{allergenName:'대두',students:4}]}); break;
    }
  }
});
