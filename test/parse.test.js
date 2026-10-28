import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUtterance, describeRecord, normalizeNumbers } from '../api/_lib/parse.js';

const babies = ['땡땡이', '콩이'];
// 2026-10-28 18:00 KST
const now = Date.UTC(2026, 9, 28, 9, 0);
const kst = (h, m, day = 28) => new Date(Date.UTC(2026, 9, day, h - 9, m)).toISOString();
const parse = (text, opts = {}) => parseUtterance(text, { babies, now, ...opts });

test('분유: 양 + 시작/종료(종료는 분만)', () => {
  const r = parse('땡땡이 분유 50미리 5시 15분부터 40분까지 먹었어').record;
  assert.equal(r.baby, '땡땡이');
  assert.equal(r.category, 'formula');
  assert.equal(r.amount, 50);
  assert.equal(r.unit, 'ml');
  assert.equal(r.startAt, kst(17, 15));
  assert.equal(r.endAt, kst(17, 40));
  assert.equal(describeRecord(r), '땡땡이 분유 50ml, 오후 5:15부터 5:40까지 기록했어요.');
});

test('글자로 받아써진 숫자', () => {
  assert.equal(normalizeNumbers('다섯 시 삼십 분 오십 미리'), '5시 30분 50미리');
  const r = parse('콩이 분유 백이십 미리 다섯 시 반부터 여섯 시까지').record;
  assert.equal(r.baby, '콩이');
  assert.equal(r.amount, 120);
  assert.equal(r.startAt, kst(17, 30));
  assert.equal(r.endAt, kst(18, 0));
});

test('오전/오후가 없으면 지금 기준 가장 최근 시각', () => {
  // 지금 18:00 → "9시"는 오늘 09:00 (21:00은 미래)
  assert.equal(parse('분유 100ml 9시').record.startAt, kst(9, 0));
  // "11시"는 오늘 11:00
  assert.equal(parse('분유 100ml 11시').record.startAt, kst(11, 0));
});

test('미래 시각이면 어제로 본다', () => {
  assert.equal(parse('밤잠 오후 11시부터 오전 6시까지').record.startAt, kst(23, 0, 27));
  assert.equal(parse('밤잠 오후 11시부터 오전 6시까지').record.endAt, kst(6, 0));
});

test('자정을 넘기는 수면', () => {
  const r = parse('땡땡이 밤잠 10시부터 6시 반까지', { now: Date.UTC(2026, 9, 28, 0, 0) }).record; // 09:00 KST
  assert.equal(r.category, 'sleep');
  assert.equal(r.detail.sleepType, 'night');
  assert.equal(r.startAt, kst(22, 0, 27));
  assert.equal(r.endAt, kst(6, 30));
});

test('까지만 말하고 기간', () => {
  const r = parse('분유 80미리 5시 40분까지 20분 동안 먹었어').record;
  assert.equal(r.startAt, kst(17, 20));
  assert.equal(r.endAt, kst(17, 40));
});

test('시각 없이 기간만 → 지금 끝난 것으로', () => {
  const r = parse('직수 15분간').record;
  assert.equal(r.endAt, kst(18, 0));
  assert.equal(r.startAt, kst(17, 45));
});

test('N분 전', () => {
  const r = parse('땡땡이 분유 60 먹었어 10분 전에').record;
  assert.equal(r.amount, 60);
  assert.equal(r.startAt, kst(17, 50));
});

test('시각이 없으면 지금', () => {
  const r = parse('땡땡이 분유 50미리').record;
  assert.equal(r.startAt, kst(18, 0));
  assert.equal(r.endAt, null);
});

test('카테고리 우선순위', () => {
  assert.equal(parse('유축수유 70미리').record.category, 'breast_stored');
  assert.equal(parse('모유저장유 70미리').record.category, 'breast_stored');
  assert.equal(parse('유축 120미리').record.category, 'pumping');
  assert.equal(parse('모유 수유 왼쪽').record.category, 'breast');
  assert.equal(parse('이유식 80그램').record.unit, 'g');
});

test('직수 좌우 분', () => {
  const r = parse('직수 왼쪽 10분 오른쪽 5분 4시 50분부터').record;
  assert.deepEqual(r.detail, { leftMin: 10, rightMin: 5, side: 'both' });
  assert.equal(r.startAt, kst(16, 50));
  assert.equal(r.endAt, kst(17, 5));
});

test('기저귀', () => {
  assert.equal(parse('기저귀 소변').record.detail.diaper, 'pee');
  assert.equal(parse('땡땡이 응가 했어').record.detail.diaper, 'poo');
});

test('콜론 시각과 물결', () => {
  const r = parse('분유 90ml 17:05~17:25').record;
  assert.equal(r.startAt, kst(17, 5));
  assert.equal(r.endAt, kst(17, 25));
});

test('모르는 카테고리', () => {
  const r = parse('땡땡이 웃었어');
  assert.equal(r.ok, false);
});

test('낮잠 확인 문장', () => {
  const r = parse('땡땡이 낮잠 2시부터 3시 반까지').record;
  assert.equal(describeRecord(r), '땡땡이 낮잠, 오후 2:00부터 3:30까지 기록했어요.');
});
