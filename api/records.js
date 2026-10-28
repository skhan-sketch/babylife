import { db, ensureSchema, rowToRecord } from './_lib/db.js';
import { checkAuth, fail, getBabies } from './_lib/http.js';
import { CATEGORY_BY_KEY, describeRecord, parseUtterance } from './_lib/parse.js';

const KST_OFFSET = 9 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

// 웹앱의 수정 화면처럼 필드를 직접 보낸 경우를 검증한다.
function validateFields(body) {
  const category = CATEGORY_BY_KEY[body.category];
  if (!category) return { error: '알 수 없는 카테고리예요.' };
  if (!body.baby || typeof body.baby !== 'string') return { error: '아기 이름이 필요해요.' };
  const start = new Date(body.startAt);
  if (Number.isNaN(start.getTime())) return { error: '시작 시각이 올바르지 않아요.' };
  let endAt = null;
  if (body.endAt) {
    const end = new Date(body.endAt);
    if (Number.isNaN(end.getTime())) return { error: '종료 시각이 올바르지 않아요.' };
    if (end < start) return { error: '종료 시각이 시작보다 빨라요.' };
    endAt = end.toISOString();
  }
  const amount = body.amount === '' || body.amount == null ? null : Number(body.amount);
  if (amount != null && !(amount >= 0)) return { error: '양이 올바르지 않아요.' };
  return {
    record: {
      baby: body.baby.trim(),
      category: category.key,
      amount,
      unit: amount != null ? body.unit || category.unit || 'ml' : null,
      startAt: start.toISOString(),
      endAt,
      detail: body.detail && typeof body.detail === 'object' ? body.detail : {},
      memo: body.memo ?? null,
    },
  };
}

async function list(req, res) {
  const sql = db();
  const { date, baby } = req.query;
  let from;
  if (date) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!m) return fail(res, 400, 'date는 YYYY-MM-DD 형식이어야 해요.');
    from = Date.UTC(+m[1], +m[2] - 1, +m[3]) - KST_OFFSET;
  } else {
    const k = new Date(Date.now() + KST_OFFSET);
    from = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - KST_OFFSET;
  }
  const fromIso = new Date(from).toISOString();
  const toIso = new Date(from + DAY).toISOString();
  // 전날 밤에 시작해서 이날 끝난 수면도 함께 보여 준다.
  const rows = await sql`
    SELECT * FROM records
    WHERE start_at < ${toIso}
      AND (start_at >= ${fromIso} OR end_at > ${fromIso})
      AND (${baby ?? null}::text IS NULL OR baby = ${baby ?? null})
    ORDER BY start_at DESC`;
  res.json({ ok: true, records: rows.map(rowToRecord) });
}

async function create(req, res) {
  const body = req.body ?? {};
  let record;
  if (typeof body.text === 'string') {
    const parsed = parseUtterance(body.text, { babies: getBabies() });
    // Siri가 실패 이유를 읽어 줄 수 있도록 200으로 돌려준다.
    if (!parsed.ok) return res.json({ ok: false, message: parsed.error });
    record = parsed.record;
  } else {
    const v = validateFields(body);
    if (v.error) return fail(res, 400, v.error);
    record = v.record;
  }

  const message = describeRecord(record);
  if (body.dryRun) return res.json({ ok: true, dryRun: true, message, record });

  const sql = db();
  const [row] = await sql`
    INSERT INTO records (baby, category, amount, unit, start_at, end_at, detail, memo)
    VALUES (${record.baby}, ${record.category}, ${record.amount}, ${record.unit},
            ${record.startAt}, ${record.endAt}, ${JSON.stringify(record.detail)}::jsonb, ${record.memo})
    RETURNING *`;
  res.status(201).json({ ok: true, message, record: rowToRecord(row) });
}

async function update(req, res, id) {
  const v = validateFields(req.body ?? {});
  if (v.error) return fail(res, 400, v.error);
  const r = v.record;
  const sql = db();
  const [row] = await sql`
    UPDATE records SET baby = ${r.baby}, category = ${r.category}, amount = ${r.amount}, unit = ${r.unit},
      start_at = ${r.startAt}, end_at = ${r.endAt}, detail = ${JSON.stringify(r.detail)}::jsonb, memo = ${r.memo}
    WHERE id = ${id}
    RETURNING *`;
  if (!row) return fail(res, 404, '기록을 찾을 수 없어요.');
  res.json({ ok: true, record: rowToRecord(row) });
}

async function remove(req, res, id) {
  const sql = db();
  const rows = await sql`DELETE FROM records WHERE id = ${id} RETURNING id`;
  if (!rows.length) return fail(res, 404, '기록을 찾을 수 없어요.');
  res.json({ ok: true });
}

export default async function handler(req, res) {
  if (!checkAuth(req, res)) return;
  try {
    await ensureSchema();
    if (req.method === 'GET') return await list(req, res);
    if (req.method === 'POST') return await create(req, res);

    const id = Number(req.query.id);
    if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'id가 필요해요.');
    if (req.method === 'PUT' || req.method === 'PATCH') return await update(req, res, id);
    if (req.method === 'DELETE') return await remove(req, res, id);

    res.setHeader('Allow', 'GET, POST, PUT, PATCH, DELETE');
    fail(res, 405, '지원하지 않는 요청이에요.');
  } catch (err) {
    console.error(err);
    fail(res, 500, `서버 오류: ${err.message}`);
  }
}
