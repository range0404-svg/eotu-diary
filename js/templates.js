// templates.js — 본문 템플릿 (작품 감상 후기)
// #작품후기 태그가 붙어 있어 통합 검색의 태그 칩으로 후기만 모아 볼 수 있습니다.

export const REVIEW_TAG = '#작품후기';

export const REVIEW_KINDS = ['영화', '책', '드라마', '애니', '전시', '공연', '음악', '게임', '웹툰', '기타'];

/** 작품 후기 본문 템플릿 */
export function reviewTemplate(kind = '') {
  return [
    `${REVIEW_TAG}${kind ? ' #' + kind : ''}`,
    '■ 작품명: ',
    `■ 분류: ${kind || REVIEW_KINDS.slice(0, 8).join(' / ')}`,
    '■ 만든 이: ',
    '■ 감상한 날·곳: ',
    '■ 별점: ☆☆☆☆☆',
    '■ 한 줄 평: ',
    '',
    '[첫인상]',
    '',
    '',
    '[인상 깊은 장면·대목]',
    '',
    '',
    '[좋았던 점]',
    '',
    '',
    '[아쉬운 점]',
    '',
    '',
    '[기억하고 싶은 문장·대사]',
    '“ ”',
    '',
    '[나에게 남은 것]',
    '',
  ].join('\n');
}

/** 본문이 작품 후기 템플릿인지 */
export const isReview = (body) => String(body || '').includes(REVIEW_TAG);

/** "■ 별점:" 줄을 n개(0~5)로 바꾼 본문 반환 */
export function setStars(body, n) {
  const stars = '★'.repeat(n) + '☆'.repeat(5 - n);
  return body.replace(/^(■\s*별점:\s*)[★☆]*.*$/m, `$1${stars}`);
}

/** "■ 한 줄 평:" 내용 (대표 문장 자동 지정용) */
export function oneLiner(body) {
  const m = String(body || '').match(/^■\s*한 줄 평:\s*(.+)$/m);
  return m ? m[1].trim() : '';
}

/** "■ 작품명:" 내용 */
export function workTitle(body) {
  const m = String(body || '').match(/^■\s*작품명:\s*(.+)$/m);
  return m ? m[1].trim() : '';
}
