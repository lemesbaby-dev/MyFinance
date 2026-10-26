#!/usr/bin/env node
// Mede contraste WCAG e daltonismo a partir de tokens.css. Sem dependências.
// Uso: node contraste.mjs   (exit 1 se algum par obrigatório falhar)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'tokens.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

// ---- parse: blocos sem indentação ":root {", ':root[data-theme="dark"] {' e o do @media ----
const decls = (body) => Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const lightBlocks = [...css.matchAll(/^:root\s*\{([^{}]*)\}/gm)].map((m) => decls(m[1]));
const darkAttr = decls(css.match(/^:root\[data-theme="dark"\]\s*\{([^{}]*)\}/m)[1]);
const darkMedia = decls(css.match(/:root:not\(\[data-theme="light"\]\)\s*\{([^{}]*)\}/)[1]);
const strip = (o) => JSON.stringify(Object.entries(o).filter(([k]) => k !== 'color-scheme').sort());
let fail = 0;
if (strip(darkAttr) !== strip(darkMedia)) { console.log('FAIL  bloco dark do @media diverge do [data-theme="dark"]'); fail++; }

const cvdOn = decls(css.match(/^:root\[data-cvd="on"\]\s*\{([^{}]*)\}/m)[1]);
const cvdDarkAttr = decls(css.match(/^:root\[data-cvd="on"\]\[data-theme="dark"\]\s*\{([^{}]*)\}/m)[1]);
const cvdDarkMedia = decls(css.match(/:root\[data-cvd="on"\]:not\(\[data-theme="light"\]\)\s*\{([^{}]*)\}/)[1]);
if (strip(cvdDarkAttr) !== strip(cvdDarkMedia)) { console.log('FAIL  bloco dark+cvd do @media diverge do [data-theme="dark"][data-cvd]'); fail++; }
const light = Object.assign({}, ...lightBlocks);
const dark = { ...light, ...darkAttr };
const lightCvd = { ...light, ...cvdOn };
const darkCvd = { ...dark, ...cvdOn, ...cvdDarkAttr };
const resolve = (vars, v, d = 0) => {
  if (d > 10) throw new Error('ciclo ' + v);
  const m = v.match(/^var\((--[\w-]+)\)$/);
  return m ? resolve(vars, vars[m[1]], d + 1) : v;
};

// ---- cor ----
const hex = (h) => { h = h.replace('#', ''); if (h.length === 3) h = [...h].map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const unlin = (c) => 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// ---- Lab / CIEDE2000 ----
const lab = (rgb) => {
  const [r, g, b] = rgb.map(lin);
  const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const Y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const Z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
};
const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;
function de2000([L1, a1, b1], [L2, a2, b2]) {
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const ap1 = (1 + G) * a1, ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1), Cp2 = Math.hypot(ap2, b2);
  const hp = (b, a) => (b === 0 && a === 0 ? 0 : (deg(Math.atan2(b, a)) + 360) % 360);
  const h1 = hp(b1, ap1), h2 = hp(b2, ap2);
  const dL = L2 - L1, dC = Cp2 - Cp1;
  let dh = 0;
  if (Cp1 * Cp2 !== 0) { dh = h2 - h1; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360; }
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin(rad(dh / 2));
  const Lm = (L1 + L2) / 2, Cpm = (Cp1 + Cp2) / 2;
  let hm = h1 + h2;
  if (Cp1 * Cp2 === 0) hm = h1 + h2;
  else if (Math.abs(h1 - h2) <= 180) hm /= 2;
  else hm = (hm + (hm < 360 ? 360 : -360)) / 2;
  const T = 1 - 0.17 * Math.cos(rad(hm - 30)) + 0.24 * Math.cos(rad(2 * hm)) + 0.32 * Math.cos(rad(3 * hm + 6)) - 0.2 * Math.cos(rad(4 * hm - 63));
  const Sl = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2);
  const Sc = 1 + 0.045 * Cpm, Sh = 1 + 0.015 * Cpm * T;
  const Rt = -2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7)) * Math.sin(rad(60 * Math.exp(-(((hm - 275) / 25) ** 2))));
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

// ---- daltonismo: Machado 2009, severidade 1.0, em RGB linear ----
const CVD = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
const sim = (rgb, M) => { const l = rgb.map(lin); return M.map((row) => Math.min(255, Math.max(0, unlin(row[0] * l[0] + row[1] * l[1] + row[2] * l[2])))); };

// ---- pares ----
const THEMES = { 'claro': light, 'escuro': dark, 'claro+cvd': lightCvd, 'escuro+cvd': darkCvd };
const C = (vars, name) => hex(resolve(vars, vars[name]));
const rows = [];
function check(theme, vars, fgName, bgName, min, kind) {
  const r = ratio(C(vars, fgName), C(vars, bgName));
  rows.push({ theme, fg: fgName, bg: bgName, kind, min, r, ok: r >= min });
}
for (const [theme, v] of Object.entries(THEMES)) {
  for (const bg of ['--surface-page', '--surface-raised', '--surface-sunken'])
    for (const fg of ['--text-strong', '--text-body', '--text-muted']) check(theme, v, fg, bg, 4.5, 'texto');
  check(theme, v, '--on-brand', '--brand', 4.5, 'texto');
  check(theme, v, '--brand', '--surface-page', 4.5, 'texto');            // marca como texto/ícone ativo
  check(theme, v, '--tabbar-active-fg', '--tabbar-active-bg', 4.5, 'texto');
  check(theme, v, '--btn-quiet-fg', '--btn-quiet-bg', 4.5, 'texto');
  check(theme, v, '--focus-ring', '--surface-page', 3, 'UI');
  check(theme, v, '--focus-ring', '--surface-raised', 3, 'UI');
  check(theme, v, '--border-strong', '--surface-raised', 1.5, 'borda');   // informativo: borda de campo
  for (const s of ['income', 'expense', 'transfer', 'forecast', 'overdue', 'pending', 'settled'])
    for (const bg of ['--surface-page', '--surface-raised', `--color-${s}-soft`]) check(theme, v, `--color-${s}`, bg, 4.5, 'valor');
  // glifo da categoria sobre a cor: usa o melhor entre tinta escura/clara (a UI escolhe por categoria)
  for (let i = 1; i <= 10; i++) {
    const cat = C(v, `--cat-${i}`);
    for (const s of ['--surface-page', '--surface-raised']) check(theme, v, `--cat-${i}`, s, 3, 'UI');
    const dk = ratio(C(v, '--cat-ink-dark'), cat), lt = ratio(C(v, '--cat-ink-light'), cat);
    rows.push({ theme, fg: `glifo(${dk >= lt ? 'escuro' : 'claro'})`, bg: `--cat-${i}`, kind: 'UI', min: 3, r: Math.max(dk, lt), ok: Math.max(dk, lt) >= 3 });
  }
}
console.log('CONTRASTE WCAG (AA texto/valor 4.5:1, UI 3:1, borda 1.5:1 informativa)\n');
console.log('tema       tipo   razão  mín   res   fg  /  bg');
for (const r of rows) console.log(`${r.theme.padEnd(10)} ${r.kind.padEnd(6)} ${r.r.toFixed(2).padStart(5)} ${String(r.min).padStart(4)}  ${r.ok ? 'PASS' : 'FAIL'}  ${r.fg} / ${r.bg}`);
const bad = rows.filter((r) => !r.ok);
fail += bad.length;
console.log(`\n${rows.length - bad.length}/${rows.length} pares passam; ${bad.length} falham.`);

// ---- daltonismo: ΔE2000 < 10 ----
const LIMIT = 10;
function cvdReport(title, names, vars) {
  let n = 0, min = 99; const out = [];
  for (const [mode, M] of [['normal', null], ...Object.entries(CVD)]) {
    const labs = names.map((nm) => lab(M ? sim(C(vars, nm), M) : C(vars, nm)));
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      const d = de2000(labs[i], labs[j]); min = Math.min(min, d);
      if (d < LIMIT) { n++; out.push(`    ${mode.padEnd(6)} ${names[i]} x ${names[j]}  ΔE=${d.toFixed(1)}`); }
    }
  }
  console.log(`
DALTONISMO · ${title} · ΔE mín=${min.toFixed(1)} · pares <${LIMIT}: ${n}`);
  out.forEach((l) => console.log(l));
  return { n, min };
}
const cats = Array.from({ length: 10 }, (_, i) => `--cat-${i + 1}`);
const fin = ['income', 'expense', 'transfer', 'forecast', 'overdue', 'pending'].map((s) => `--color-${s}`);
const sum = [];
for (const [theme, v] of Object.entries(THEMES)) {
  const c = cvdReport(`categorias, ${theme}`, cats, v), f = cvdReport(`financeiro, ${theme}`, fin, v);
  sum.push(`${theme}: cat ${c.n} (mín ${c.min.toFixed(1)}), fin ${f.n} (mín ${f.min.toFixed(1)})`);
  if (theme.endsWith('+cvd') && c.min < LIMIT) { fail++; console.log('FAIL  categorias no modo cvd com ΔE<10'); }
}
console.log('\nResumo ΔE<10 (off é informativo; on exige categorias=0):\n  ' + sum.join('\n  '));
console.log('Em qualquer modo, glifo/sinal/rótulo continuam obrigatórios (cor nunca é o único canal).');
process.exit(fail ? 1 : 0);
