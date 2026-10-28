import { timingSafeEqual } from 'node:crypto';

export function getBabies() {
  const names = (process.env.BABY_NAMES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return names.length ? names : ['아기'];
}

// API_TOKEN 환경 변수와 같은 토큰을 "Authorization: Bearer <토큰>" 헤더로 보내야 한다.
export function checkAuth(req, res) {
  const expected = process.env.API_TOKEN;
  if (!expected) {
    res.status(500).json({ ok: false, message: 'API_TOKEN 환경 변수가 설정되지 않았어요.' });
    return false;
  }
  const header = req.headers.authorization || '';
  const given = header.replace(/^Bearer\s+/i, '').trim();
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ ok: false, message: '토큰이 맞지 않아요.' });
    return false;
  }
  return true;
}

export function fail(res, status, message) {
  res.status(status).json({ ok: false, message });
}
