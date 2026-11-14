// PUBLIC food names reviewed in code. Never populate from student/school data or HTTP input.
// A name outside this catalog fails closed; extend the catalog through code review.
export const publicFoods = [
  '잡곡밥', '현미밥', '흑미밥', '쌀밥', '미역국', '된장국', '콩나물국', '어묵국', '유부국',
  '닭갈비', '닭강정', '계란찜', '돈육장조림', '카레라이스', '땅콩조림', '숙주무침',
  '감자조림', '멸치볶음', '시금치무침', '양배추샐러드', '배추김치', '깍두기', '총각김치',
  '귤', '요구르트', '사과', '우유', '바나나', '두부조림', '닭가슴살볶음', '감자채볶음', '우유푸딩', '무',
] as const;
