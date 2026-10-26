import { money } from '../lib/format.js';

// Regra de dinheiro continua em lib/format.js (centavos inteiros, BRL); aqui só apresentação e máscara.
const MINUS = '−';
const SIGN = { income: '+', expense: MINUS };

/** "+R$ 1,00" (receita) | "−R$ 1,00" (despesa) | "R$ 1,00" (demais; negativo vira "−"). Sinal é obrigatório: cor nunca é o único canal. */
export function moneyText(cents, kind = 'neutral', signed = true) {
  const c = cents ?? 0;
  const sign = !signed ? '' : (SIGN[kind] ?? (c < 0 ? MINUS : ''));
  return sign + money(Math.abs(c));
}

/** Digitação em centavos: só dígitos contam, o valor "entra pela direita". Aceita "R$ 1.234,56", "123456". Teto = 13 dígitos (< 1e14, igual ao servidor). */
export const centsFromInput = (s) => parseInt(String(s).replace(/\D/g, '').slice(0, 13) || '0', 10);
