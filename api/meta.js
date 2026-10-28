import { CATEGORIES } from './_lib/parse.js';
import { checkAuth, getBabies } from './_lib/http.js';

export default function handler(req, res) {
  if (!checkAuth(req, res)) return;
  res.json({
    ok: true,
    babies: getBabies(),
    categories: CATEGORIES.map(({ key, label, amount, unit }) => ({ key, label, amount, unit: unit ?? null })),
  });
}
