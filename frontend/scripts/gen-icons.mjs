// Gera os PNGs do app a partir de public/icon.svg (sem cantos arredondados: o SO recorta/mascara).
// Rasteriza com o Edge/Chrome headless já instalado; rode só quando mudar o desenho: node scripts/gen-icons.mjs
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const browser = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
if (!browser) throw new Error('Edge/Chrome não encontrado');

const svg = readFileSync('public/icon.svg', 'utf8').replace(/ rx="\d+"/, '');
const dir = mkdtempSync(join(tmpdir(), 'icons-'));
for (const [file, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['icon-maskable-512.png', 512], ['apple-touch-icon.png', 180]]) {
  const page = join(dir, 'p.html');
  writeFileSync(page, `<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  execFileSync(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=${size},${size}`, `--screenshot=${join(process.cwd(), 'public', file)}`, pathToFileURL(page).href]);
}
