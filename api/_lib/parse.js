// Siri 받아쓰기 문장("땡땡이 분유 50미리 5시 15분부터 40분까지 먹었어")을 기록 객체로 해석한다.
// 시각은 모두 한국 시간(KST) 기준으로 해석하고, 결과는 UTC 밀리초로 돌려준다.

const KST_OFFSET = 9 * 60 * 60 * 1000;
const MIN = 60 * 1000;
// 말한 시각이 서버 시각보다 조금 미래여도 "오늘"로 인정하는 여유
const FUTURE_TOLERANCE = 10 * MIN;

// 카테고리를 추가하려면 여기에 한 줄 추가하면 된다.
// 순서가 우선순위다: "유축수유"가 "유축"보다, "모유저장유"가 "모유"보다 먼저 검사돼야 한다.
export const CATEGORIES = [
  { key: 'breast_stored', label: '모유저장유', words: ['모유저장유', '저장모유', '저장유', '유축수유', '유축모유'], amount: true, unit: 'ml' },
  { key: 'pumping', label: '유축', words: ['유축'], amount: true, unit: 'ml' },
  { key: 'formula', label: '분유', words: ['분유'], amount: true, unit: 'ml' },
  { key: 'baby_food', label: '이유식', words: ['이유식'], amount: true, unit: 'g' },
  { key: 'breast', label: '직수', words: ['직수', '모유수유', '모유', '젖먹'], amount: false },
  { key: 'diaper', label: '기저귀', words: ['기저귀', '소변', '대변', '쉬야', '응가', '똥'], amount: false },
  { key: 'sleep', label: '잠', words: ['낮잠', '밤잠', '수면', '잠', '잤', '재웠'], amount: false },
];

export const CATEGORY_BY_KEY = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));

const SINO = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 };
const NATIVE = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10, 열한: 11, 열두: 12 };
const NATIVE_RE = '(열한|열두|다섯|여섯|일곱|여덟|아홉|한|두|세|네|열)';

function sinoToNumber(word) {
  let total = 0;
  let cur = 0;
  for (const ch of word) {
    if (ch === '백') { total += (cur || 1) * 100; cur = 0; }
    else if (ch === '십') { total += (cur || 1) * 10; cur = 0; }
    else if (SINO[ch]) cur = SINO[ch];
    else return null;
  }
  return total + cur;
}

// "다섯 시 삼십 분", "오십 미리"처럼 글자로 받아써진 숫자를 아라비아 숫자로 바꾼다.
export function normalizeNumbers(text) {
  return text
    .replace(new RegExp(`(?<![가-힣])${NATIVE_RE}\\s*시간`, 'g'), (_, w) => `${NATIVE[w]}시간`)
    .replace(new RegExp(`(?<![가-힣])${NATIVE_RE}\\s*시(?!간)`, 'g'), (_, w) => `${NATIVE[w]}시`)
    .replace(/(?<![가-힣])([일이삼사오육칠팔구십백]+)\s*(분|미리|밀리|씨씨|그램)/g, (m, w, unit) => {
      const n = sinoToNumber(w);
      return n == null ? m : `${n}${unit}`;
    });
}

function kstParts(ms) {
  const d = new Date(ms + KST_OFFSET);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
}

function kstToMs(y, mo, d, h, mi) {
  return Date.UTC(y, mo, d, h, mi) - KST_OFFSET;
}

// 말한 "N시"가 24시간제로 몇 시일 수 있는지 후보를 돌려준다.
function hourCandidates(h, period) {
  if (h > 24) return [];
  if (h >= 13 || h === 0 || h === 24) return [h % 24];
  switch (period) {
    case '오전': case '새벽': case '아침':
      return [h % 12];
    case '오후': case '저녁':
      return [h === 12 ? 12 : h + 12];
    case '낮': case '점심':
      return [h <= 6 ? h + 12 : h];
    case '밤':
      if (h === 12) return [0];
      return [h <= 4 ? h : h + 12];
    default:
      return h === 12 ? [12, 0] : [h, h + 12];
  }
}

// 지금보다 과거(약간의 여유 포함)인 후보 중 가장 최근 시각
function latestPast(item, now) {
  const today = kstParts(now);
  let best = null;
  for (const dayOffset of [0, -1]) {
    for (const h of hourCandidates(item.h, item.period)) {
      const ms = kstToMs(today.y, today.mo, today.d + dayOffset, h, item.m);
      if (ms <= now + FUTURE_TOLERANCE && (best == null || ms > best)) best = ms;
    }
  }
  return best;
}

// 시작 시각 이후인 후보 중 가장 이른 시각
function earliestAfter(item, start) {
  const s = kstParts(start);
  if (item.h == null) {
    // "5시 15분부터 40분까지"의 "40분"
    let ms = kstToMs(s.y, s.mo, s.d, s.h, item.m);
    if (ms < start) ms += 60 * MIN;
    return ms;
  }
  let best = null;
  for (const dayOffset of [0, 1]) {
    for (const h of hourCandidates(item.h, item.period)) {
      const ms = kstToMs(s.y, s.mo, s.d + dayOffset, h, item.m);
      if (ms >= start && (best == null || ms < best)) best = ms;
    }
  }
  return best;
}

const AMOUNT_RE = /(\d+(?:\.\d+)?)\s*(밀리리터|미리리터|밀리|미리|ml|㎖|씨씨|cc|그램|g)(?![a-z])/i;
// "1시간 30분 동안", "15분간", "한시간 반 동안"
const DURATION_RE = /(?:(\d+)\s*시간\s*(반)?\s*)?(?:(\d+)\s*분\s*)?(?:동안|간)/g;
// "10분 전에", "1시간 전"
const RELATIVE_RE = /(?:(\d+)\s*시간\s*(반)?\s*)?(?:(\d+)\s*분\s*)?전/g;
const SIDE_MIN_RE = /(왼쪽|왼편|좌측|오른쪽|오른편|우측)\s*(\d+)\s*분/g;
const TIME_RE = /(?:(오전|오후|새벽|아침|낮|점심|저녁|밤)\s*)?(?:(\d{1,2})\s*시(?!간)\s*(?:(\d{1,2})\s*분|(반))?|(\d{1,2}):(\d{2})|(\d{1,2})\s*분)(\s*(?:부터|에서|~|-|까지))?/g;

function minutesOf(hours, half, minutes) {
  return (Number(hours || 0) * 60) + (half ? 30 : 0) + Number(minutes || 0);
}

function findCategory(compact) {
  for (const cat of CATEGORIES) {
    if (cat.words.some((w) => compact.includes(w))) return cat;
  }
  return null;
}

function findBaby(text, babies) {
  return babies.find((name) => text.includes(name)) ?? babies[0];
}

/**
 * @param {string} rawText 받아쓰기된 문장
 * @param {{ babies: string[], now?: number }} options
 * @returns {{ ok: true, record: object } | { ok: false, error: string }}
 */
export function parseUtterance(rawText, { babies, now = Date.now() }) {
  const original = String(rawText ?? '').trim();
  if (!original) return { ok: false, error: '기록할 내용이 비어 있어요.' };

  let text = normalizeNumbers(original);
  const compact = text.replace(/\s+/g, '');
  const category = findCategory(compact);
  if (!category) {
    return { ok: false, error: `어떤 기록인지 모르겠어요: "${original}". 분유, 직수, 모유저장유, 유축, 잠, 기저귀, 이유식 중 하나를 말해 주세요.` };
  }

  const baby = findBaby(text, babies);
  const detail = {};

  // 양
  let amount = null;
  let unit = category.unit ?? null;
  const amountMatch = text.match(AMOUNT_RE);
  if (amountMatch) {
    amount = Number(amountMatch[1]);
    unit = /그램|g/i.test(amountMatch[2]) ? 'g' : 'ml';
    text = text.replace(amountMatch[0], ' ');
  } else if (category.amount) {
    // "분유 50 먹었어"처럼 단위 없이 카테고리 바로 뒤에 숫자를 말한 경우
    const bare = text.match(new RegExp(`(?:${category.words.join('|')})\\s*(\\d+)(?!\\s*(?:시|분|:|\\d))`));
    if (bare) {
      amount = Number(bare[1]);
      text = text.replace(bare[0], ' ');
    }
  }

  // 직수 좌우
  let sideMinutes = 0;
  if (category.key === 'breast') {
    text = text.replace(SIDE_MIN_RE, (_, side, min) => {
      const key = /왼|좌/.test(side) ? 'leftMin' : 'rightMin';
      detail[key] = Number(min);
      sideMinutes += Number(min);
      return ' ';
    });
    const left = /왼쪽|왼편|좌측/.test(original) || detail.leftMin != null;
    const right = /오른쪽|오른편|우측/.test(original) || detail.rightMin != null;
    if (left || right) detail.side = left && right ? 'both' : left ? 'left' : 'right';
  }

  if (category.key === 'diaper') {
    const pee = /소변|쉬/.test(original);
    const poo = /대변|응가|똥/.test(original);
    detail.diaper = pee && poo ? 'both' : poo ? 'poo' : pee ? 'pee' : undefined;
    if (!detail.diaper) delete detail.diaper;
  }

  if (category.key === 'sleep') {
    if (/낮잠/.test(compact)) detail.sleepType = 'nap';
    else if (/밤잠/.test(compact)) detail.sleepType = 'night';
  }

  // 기간
  let durationMin = null;
  text = text.replace(DURATION_RE, (m, h, half, mi) => {
    if (h == null && mi == null) return m;
    durationMin = minutesOf(h, half, mi);
    return ' ';
  });
  if (durationMin == null && sideMinutes > 0) durationMin = sideMinutes;

  // "N분 전"
  let relativeMin = null;
  text = text.replace(RELATIVE_RE, (m, h, half, mi) => {
    if (h == null && mi == null) return m;
    relativeMin = minutesOf(h, half, mi);
    return ' ';
  });

  // 시각
  const items = [];
  for (const m of text.matchAll(TIME_RE)) {
    const [, period, h1, m1, half, h2, m2, minOnly, marker] = m;
    let item;
    if (h1 != null) item = { h: Number(h1), m: half ? 30 : Number(m1 ?? 0), period };
    else if (h2 != null) item = { h: Number(h2), m: Number(m2), period };
    else item = { h: null, m: Number(minOnly), period };
    if (item.m > 59) continue;
    item.role = !marker ? null : marker.includes('까지') ? 'end' : 'start';
    items.push(item);
  }

  let startItem = items.find((i) => i.role === 'start');
  let endItem = items.find((i) => i.role === 'end');
  const unmarked = items.filter((i) => i.role == null);
  if (!startItem && !endItem) {
    [startItem, endItem] = unmarked;
  } else if (!startItem) {
    startItem = items.find((i) => i !== endItem && i.role !== 'end');
  } else if (!endItem) {
    endItem = items.find((i) => i !== startItem && i.role !== 'start');
  }
  // 시 없이 "40분"만 있는 건 시작 시각이 될 수 없다
  if (startItem?.h == null) startItem = undefined;

  let startAt = startItem ? latestPast(startItem, now) : null;
  if (startAt == null && relativeMin != null) startAt = now - relativeMin * MIN;

  let endAt = null;
  if (endItem) {
    if (startAt != null) endAt = earliestAfter(endItem, startAt);
    else if (endItem.h != null) endAt = latestPast(endItem, now);
  }

  if (durationMin != null) {
    if (startAt != null && endAt == null) endAt = startAt + durationMin * MIN;
    else if (startAt == null && endAt != null) startAt = endAt - durationMin * MIN;
    else if (startAt == null && endAt == null) {
      endAt = now;
      startAt = now - durationMin * MIN;
    }
  }

  if (startAt == null) {
    startAt = endAt ?? now;
    if (endAt === startAt) endAt = null;
  }

  return {
    ok: true,
    record: {
      baby,
      category: category.key,
      amount,
      unit: amount != null ? unit : null,
      startAt: new Date(startAt).toISOString(),
      endAt: endAt != null ? new Date(endAt).toISOString() : null,
      detail,
      memo: original,
    },
  };
}

export function formatKstTime(iso) {
  const p = kstParts(new Date(iso).getTime());
  const period = p.h < 12 ? '오전' : '오후';
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
  return { period, text: `${h12}:${String(p.mi).padStart(2, '0')}` };
}

const SIDE_LABEL = { left: '왼쪽', right: '오른쪽', both: '양쪽' };
const DIAPER_LABEL = { pee: '소변', poo: '대변', both: '소변+대변' };
const SLEEP_LABEL = { nap: '낮잠', night: '밤잠' };

// Siri가 읽어 줄 확인 문장
export function describeRecord(record) {
  const cat = CATEGORY_BY_KEY[record.category];
  const d = record.detail ?? {};
  // "잠 낮잠"이 아니라 "낮잠"으로 읽히게 한다
  const parts = [record.baby, (d.sleepType && SLEEP_LABEL[d.sleepType]) || cat?.label || record.category];
  if (record.amount != null) parts.push(`${record.amount}${record.unit ?? ''}`);
  if (d.side) parts.push(SIDE_LABEL[d.side]);
  if (d.diaper) parts.push(DIAPER_LABEL[d.diaper]);

  const s = formatKstTime(record.startAt);
  let when = `${s.period} ${s.text}`;
  if (record.endAt) {
    const e = formatKstTime(record.endAt);
    when += `부터 ${e.period === s.period ? '' : `${e.period} `}${e.text}까지`;
  }
  return `${parts.join(' ')}, ${when} 기록했어요.`;
}
