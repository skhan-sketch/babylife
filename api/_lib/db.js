import { neon } from '@neondatabase/serverless';

let client;
let schemaReady;

export function db() {
  if (!client) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error('DATABASE_URL이 설정되지 않았어요. Vercel Storage에서 Neon 데이터베이스를 연결해 주세요.');
    client = neon(url);
  }
  return client;
}

// 첫 요청 때 테이블을 만든다. 따로 SQL을 실행할 필요가 없다.
export function ensureSchema() {
  schemaReady ??= (async () => {
    const sql = db();
    await sql`
      CREATE TABLE IF NOT EXISTS records (
        id BIGSERIAL PRIMARY KEY,
        baby TEXT NOT NULL,
        category TEXT NOT NULL,
        amount NUMERIC,
        unit TEXT,
        start_at TIMESTAMPTZ NOT NULL,
        end_at TIMESTAMPTZ,
        detail JSONB NOT NULL DEFAULT '{}'::jsonb,
        memo TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS records_start_at_idx ON records (start_at)`;
  })().catch((err) => {
    schemaReady = undefined;
    throw err;
  });
  return schemaReady;
}

const iso = (v) => (v == null ? null : new Date(v).toISOString());

export function rowToRecord(row) {
  return {
    id: Number(row.id),
    baby: row.baby,
    category: row.category,
    amount: row.amount == null ? null : Number(row.amount),
    unit: row.unit,
    startAt: iso(row.start_at),
    endAt: iso(row.end_at),
    detail: row.detail ?? {},
    memo: row.memo,
    createdAt: iso(row.created_at),
  };
}
