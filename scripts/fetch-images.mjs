import { mkdir, writeFile, access, appendFile } from 'node:fs/promises';

const PROJECT_ID = 'ovni-b5823';
const API_KEY = 'AIzaSyAjIY9iH0gZT9WalyKTUh6zNinBNvt9aqQ';
const SITE = 'https://caramellca.github.io/OVNI/';
const OUT_DIR = 'images/60';
const MODE = process.env.MODE || 'download';
const FORCE = process.env.FORCE === 'true';
const IMAGE_URL = /^https:\/\/www\.lowadi\.com\/media\/equideo\/image\/{1,2}(?:produits|fonctionnels)\/60\/[A-Za-z0-9_-]+\.png$/;
const ID = /^[A-Za-z0-9_-]+$/;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const exists = async p => { try { await access(p); return true; } catch { return false; } };
const isPng = b => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a;

async function loadCatalog() {
  const entries = [];
  let token = '';
  for (let page = 0; page < 20; page++) {
    const url = new URL(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/itemCatalog`);
    url.searchParams.set('key', API_KEY);
    url.searchParams.set('pageSize', '300');
    if (token) url.searchParams.set('pageToken', token);
    const response = await fetch(url, { headers: { Referer: SITE }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Не удалось прочитать справочник предметов: HTTP ${response.status}`);
    const result = await response.json();
    for (const doc of result.documents || []) {
      const docId = decodeURIComponent(doc.name.split('/').pop());
      const f = doc.fields || {};
      entries.push({ docId, identifier: f.identifier?.stringValue || '', img: f.img?.stringValue || '' });
    }
    token = result.nextPageToken || '';
    if (!token) return entries;
  }
  throw new Error('Справочник предметов слишком большой');
}

function buildTasks(entries) {
  const tasks = [], skipped = [], seen = new Set();
  for (const e of entries) {
    if (!e.img) continue;
    const id = e.identifier || e.docId;
    if (!ID.test(id) || !IMAGE_URL.test(e.img)) { skipped.push({ id, reason: 'неожиданный адрес или имя' }); continue; }
    if (seen.has(id)) continue;
    seen.add(id);
    tasks.push({ id, url: e.img, file: `${OUT_DIR}/${id}.png` });
  }
  return { tasks, skipped };
}

async function summary(lines) {
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Картинки предметов\n\n${lines.join('  \n')}\n`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const entries = await loadCatalog();
  const { tasks, skipped } = buildTasks(entries);
  const missing = [];
  for (const t of tasks) if (FORCE || !await exists(t.file)) missing.push(t);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `need=${missing.length > 0}\n`);
  const base = [
    `Предметов с картинкой: ${tasks.length}`,
    `Нужно скачать: ${missing.length}`,
    `Пропущено из-за необычного адреса: ${skipped.length}${skipped.length ? ' (' + skipped.map(s => s.id).join(', ') + ')' : ''}`
  ];
  if (MODE === 'plan' || !missing.length) { await summary(base); return; }

  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const context = await browser.newContext({ locale: 'ru-RU' });
  const page = await context.newPage();
  try {
    await page.goto('https://www.lowadi.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(5000);
  } catch (e) {
    console.log(`Прогрев не удался: ${e.message}`.slice(0, 200));
  }
  let saved = 0;
  const failed = [];
  for (const t of missing) {
    let ok = false, reason = '';
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      try {
        const response = await page.goto(t.url, { waitUntil: 'load', timeout: 30000 });
        const type = response?.headers()['content-type'] || '';
        if (!response || response.status() !== 200 || !type.startsWith('image/')) {
          reason = `HTTP ${response?.status()} ${type}`;
        } else {
          const body = await response.body();
          if (!isPng(body) || body.length > 300000) reason = 'файл не похож на PNG или слишком большой';
          else { await writeFile(t.file, body); ok = true; }
        }
      } catch (e) {
        reason = e.message.slice(0, 200);
      }
      if (!ok) await sleep(5000 * attempt);
    }
    if (ok) saved++; else failed.push({ id: t.id, reason });
    await sleep(1500);
  }
  await browser.close();
  await summary([
    ...base,
    `Скачано: ${saved}`,
    `Не удалось: ${failed.length}${failed.length ? ' — ' + failed.map(f => `${f.id} (${f.reason})`).join('; ') : ''}`
  ]);
  if (failed.length) process.exitCode = 1;
}

main().catch(e => {
  console.error(e.message);
  process.exitCode = 1;
});
