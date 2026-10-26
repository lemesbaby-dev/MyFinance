const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** centavos (inteiro) -> "R$ 1.234,56" */
export const money = (cents) => brl.format((cents ?? 0) / 100);

/** "1.234,56" | "1234.56" | "12" -> centavos (inteiro). Devolve null se inválido. */
export function parseMoney(input) {
  let s = String(input).replace(/R\$|\s/g, '');
  if (!s) return null;
  const neg = s.startsWith('-');
  s = s.replace('-', '');
  const m = s.match(/^(.*?)[.,](\d{1,2})$/);
  const intPart = (m ? m[1] : s).replace(/[.,]/g, '');
  const frac = (m ? m[2] : '').padEnd(2, '0');
  if (!/^\d*$/.test(intPart) || !/^\d{2}$/.test(frac)) return null;
  const v = parseInt(intPart || '0', 10) * 100 + parseInt(frac, 10);
  return neg ? -v : v;
}

export const isoToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const endOfMonthISO = () => {
  const d = new Date();
  const e = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, '0')}-${String(e.getDate()).padStart(2, '0')}`;
};

/** "2026-10-30" -> "30/10" */
export const shortDate = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
