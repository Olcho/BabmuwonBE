export type Citation = {title:string;url:string};

export const citationReviewMessage = '출처 연결을 확인하지 못한 부분이 있습니다. 영양사가 원문과 본문을 대조해 주세요.';
export const citationWarnings = {
  empty_citation_url: '빈 링크',
  placeholder_citation_url: '예시 링크',
  citation_unlinked: '출처 미연결',
} as const;

export function citationUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^https?:\/\//iu.test(value.trim())) return;
  try {
    const url = new URL(value.trim());
    if (url.username || url.password || placeholderUrl(url)) return;
    return url.href;
  } catch { return; }
}

function placeholderUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/\.$/u,'');
  return /(?:^|\.)(?:example\.(?:com|net|org)|invalid|example|test|localhost|local)$/u.test(host)
    || /^(?:placeholder|your-domain|your-url)(?:\.|$)/u.test(host)
    || /\/(?:placeholder|your-url)(?:\/|$)/iu.test(url.pathname);
}

// Match Markdown links before numeric markers so [1](url) is a single citation.
const inlineCitation = /\[([^\]\n]*)\]\(\s*(?:<([^>\n]*)>|([^\s)\n]*))\s*\)|\(\((\d+(?:\s*,\s*\d+)*)\)\)|\[(\d+(?:\s*,\s*\d+)*)\]|https?:\/\/[^\s<>\[\]()「」【】]*/giu;

function link(label: string, url: string): string {
  return `[${label}](<${url}>)`;
}

export function matchSearchCitations(text: string, refs: readonly Citation[], chunks: readonly unknown[]) {
  const byUrl = new Map(refs.map(ref => [ref.url,ref]));
  const byNumber = new Map<number,string | undefined>();
  for (const chunk of chunks) {
    if (!chunk || typeof chunk !== 'object') continue;
    const {num,sourceUrl} = chunk as {num?:unknown;sourceUrl?:unknown};
    if (typeof num !== 'number' || !Number.isSafeInteger(num) || num < 1) continue;
    const url = citationUrl(sourceUrl);
    // Conflicting mappings must not silently replace an earlier mapping.
    if (byNumber.has(num) && byNumber.get(num) !== url) byNumber.set(num,undefined);
    else byNumber.set(num,url);
  }

  const matched = new Set<string>();
  let mismatch = false;
  let linkBudget = 20_000;
  const warning = (reason: keyof typeof citationWarnings) => {
    mismatch = true;
    return `〔${citationWarnings[reason]}〕`;
  };
  const resolveNumber = (number: string) => {
    const url = byNumber.get(Number(number));
    if (!url || !byUrl.has(url)) return warning('citation_unlinked');
    const linked = link(number,url);
    // Bound expansion when the answer repeats references to long URLs.
    if (linked.length > linkBudget) return warning('citation_unlinked');
    linkBudget -= linked.length;
    matched.add(url);
    return linked;
  };
  const body = text.replace(inlineCitation, (raw, label, angleUrl, markdownUrl, doubleParen, bracket) => {
    const numbers = doubleParen ?? bracket;
    if (numbers !== undefined) return numbers.split(/\s*,\s*/u).map(resolveNumber).join(' ');
    const candidate = angleUrl ?? markdownUrl ?? raw.replace(/[.,;!?。]+$/u,'');
    if (!candidate || /^(?:#|https?:\/\/)$/iu.test(candidate)) return warning('empty_citation_url');
    const url = citationUrl(candidate);
    if (!url || !byUrl.has(url)) {
      if (!url) {
        try { if (placeholderUrl(new URL(candidate))) return warning('placeholder_citation_url'); } catch {}
      }
      return warning('citation_unlinked');
    }
    if (label !== undefined && /^\d+$/u.test(label) && byNumber.has(Number(label)) && byNumber.get(Number(label)) !== url) {
      return warning('citation_unlinked');
    }
    matched.add(url);
    return raw;
  });
  const sourceMissing = mismatch || matched.size === 0;
  // The legacy limit applies to unused search results only, never to linked citations.
  const citations = Array.from(matched, url => byUrl.get(url)!);
  if (citations.length < 20) {
    citations.push(...Array.from(byUrl.values()).filter(ref => !matched.has(ref.url)).slice(0,20-citations.length));
  }
  return {text:sourceMissing ? `${body}\n\n${citationReviewMessage}` : body,citations,sourceMissing};
}
