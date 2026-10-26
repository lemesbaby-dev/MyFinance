const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** centavos (inteiro) -> "R$ 1.234,56" */
export const money = (cents) => brl.format((cents ?? 0) / 100);

/** "1.234,56" | "1234.56" | "1.000" | "12" -> centavos (inteiro). Devolve null se inválido ou grande demais (ex.: "0,001", "1.23.4"). */
export function parseMoney(input) {
  const s = String(input).replace(/R\$|\s/g, '');
  const neg = s.startsWith('-');
  const m = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:[.,](\d{1,2}))?$/.exec(neg ? s.slice(1) : s);
  if (!m) return null;
  const v = parseInt(m[1].replace(/\./g, ''), 10) * 100 + parseInt((m[2] ?? '').padEnd(2, '0'), 10);
  if (!(v < 1e14)) return null; // mesmo teto do servidor (|centavos| < 1e14); também pega NaN/Infinity
  return neg ? -v : v;
}

/** "2026-10-30" -> "30/10" */
export const shortDate = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
