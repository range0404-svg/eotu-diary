// samples.js — 처음 실행 시 넣는 3일 치 샘플 일기 (복선 체크박스 · 반복어 · 습관어 · 1인칭 · 만연체 · 주석 · 태그)
// 필요 없으면 목록에서 각각 삭제하거나 ⚙ 설정 → [샘플 일기 삭제]

export const SAMPLE_PREFIX = 'sample-';

export function buildSamples(addDays, today) {
  const d3 = addDays(today, -3), d2 = addDays(today, -2), d1 = addDays(today, -1);
  const t = Date.now();
  return [
    {
      id: SAMPLE_PREFIX + '1', date: d3, updatedAt: t - 3000,
      foreshadow: '[x] 09:30 주간 회의 #업무\n[x] 보고서 초안 작성 #업무\n[ ] 은행 서류 제출',
      body: '오늘은 약간 피곤했다. 아침에 주간 회의가 있었다. 회의에서 내가 발표를 맡았다. 나는 진짜 떨렸다. 나는 발표를 마치고 나서야 숨을 돌렸다.\n점심에는 동료들과 국밥을 먹었다. 그냥 좀 쉬고 싶었다.',
      footnote: '※ 회의록은 공유 드라이브 /2026/주간회의 폴더에 저장됨 #업무',
      highlightSentence: '발표를 마치고 나서야 숨을 돌렸다.',
    },
    {
      id: SAMPLE_PREFIX + '2', date: d2, updatedAt: t - 2000, pinned: true,
      foreshadow: '[ ] 은행 서류 제출\n[x] 택배 반품 접수\n[ ] 14:00 거래처 통화 #업무',
      body: '사실 오늘은 정말 정신없는 하루였는데 아침부터 거래처 연락이 계속 와서 정리하고 또 정리하다 보니 점심도 제대로 못 먹고 오후 내내 메일만 붙잡고 있었다.\n정리가 끝나고 나니 너무 허탈했다. 정말 너무 길었다.\n#업무 #야근',
      footnote: '※ 14:05 거래처 김 과장과 통화 — 납기 3일 연기 합의 (통화 녹음 보관)\n※ 메일 원본은 받은편지함 "납기" 라벨',
    },
    {
      id: SAMPLE_PREFIX + '3', date: d1, updatedAt: t - 1000,
      foreshadow: '[ ] 은행 서류 제출\n[ ] 운동 30분\n- 저녁 약속 19:00',
      body: '아침에 일찍 일어났다. 공원을 걸었다. 커피를 마셨다. 기분이 좋아졌다.\n저녁에는 오랜만에 친구를 만났다. 서로의 근황을 나누며 웃었다. #일상',
      footnote: '※ 은행 서류는 내일 오전으로 다시 미룸',
      highlightSentence: '서로의 근황을 나누며 웃었다.',
    },
  ];
}
