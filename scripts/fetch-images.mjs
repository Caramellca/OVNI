import { chromium } from 'playwright';
import { mkdir, writeFile, stat, appendFile } from 'node:fs/promises';

const FORCE = process.env.FORCE === 'true';
const PROJECT_ID = 'ovni-b5823';
const API_KEY = 'AIzaSyAjIY9iH0gZT9WalyKTUh6zNinBNvt9aqQ';
const SITE_REFERER = 'https://caramellca.github.io/OVNI/';
const IMAGE_DIR = 'images/60';
const REPORT_DIR = 'fetch-output';
const PAUSE_MS = 1000;
const FAIL_LIMIT = 5;
const MAX_BYTES = 2 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];

function safeImageUrl(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.hostname !== 'www.lowadi.com') return null;
    if (!/\.png$/i.test(u.pathname) || u.search || u.hash) return null;
    return u.href;
  } catch { return null; }
}

async function loadCatalog() {
  const entries = [];
  let token = '';
  for (let page = 0; page < 20; page++) {
    const url = new URL(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/itemCatalog`);
    url.searchParams.set('pageSize', '300');
    url.searchParams.set('key', API_KEY);
    if (token) url.searchParams.set('pageToken', token);
    const response = await fetch(url, { headers: { Referer: SITE_REFERER }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Не удалось прочитать справочник предметов: HTTP ${response.status}`);
    const json = await response.json();
    for (const doc of json.documents || []) {
      const id = decodeURIComponent(String(doc.name || '').split('/').pop());
      entries.push({ id, img: doc.fields?.img?.stringValue || '' });
    }
    token = json.nextPageToken || '';
    if (!token) return entries;
  }
  throw new Error('Справочник предметов слишком большой');
}

async function exists(path) {
  try { return (await stat(path)).size > 0; } catch { return false; }
}

function checkPng(body) {
  if (!body || body.length < 8) return 'пустой ответ';
  if (body.length > MAX_BYTES) return 'файл слишком большой';
  if (!body.subarray(0, 8).equals(PNG_SIGNATURE)) return 'ответ не является PNG';
  return null;
}

async function viaNavigation(nav, url) {
  const response = await nav.goto(url, { waitUntil: 'load', timeout: 30000 });
  if (!response) return { error: 'нет ответа' };
  if (response.status() !== 200) return { error: `HTTP ${response.status()}` };
  const body = await response.body();
  const problem = checkPng(body);
  return problem ? { error: problem } : { body };
}

async function viaPageFetch(home, url) {
  const result = await home.evaluate(async address => {
    const r = await fetch(address, { credentials: 'include' });
    if (!r.ok) return { status: r.status };
    const bytes = new Uint8Array(await r.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { status: r.status, data: btoa(binary) };
  }, url);
  if (result.status !== 200) return { error: `HTTP ${result.status}` };
  const body = Buffer.from(result.data, 'base64');
  const problem = checkPng(body);
  return problem ? { error: problem } : { body };
}

async function download(nav, home, url) {
  const reasons = [];
  try {
    const r = await viaNavigation(nav, url);
    if (r.body) return { body: r.body, method: 'navigation' };
    reasons.push(`переход: ${r.error}`);
  } catch (e) { reasons.push(`переход: ${String(e.message).slice(0, 120)}`); }
  try {
    const r = await viaPageFetch(home, url);
    if (r.body) return { body: r.body, method: 'page-fetch' };
    reasons.push(`запрос со страницы: ${r.error}`);
  } catch (e) { reasons.push(`запрос со страницы: ${String(e.message).slice(0, 120)}`); }
  return { error: reasons.join('; ') };
}

async function main() {
  await mkdir(IMAGE_DIR, { recursive: true });
  await mkdir(REPORT_DIR, { recursive: true });

  const catalog = await loadCatalog();
  const todo = [];
  for (const { id, img } of catalog) {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) { results.push({ id, status: 'skipped', reason: 'недопустимый идентификатор' }); continue; }
    if (!img) { results.push({ id, status: 'skipped', reason: 'у предмета нет картинки' }); continue; }
    const url = safeImageUrl(img);
    if (!url) { results.push({ id, status: 'skipped', reason: 'адрес картинки не прошёл проверку' }); continue; }
    if (!FORCE && await exists(`${IMAGE_DIR}/${id}.png`)) { results.push({ id, status: 'skipped', reason: 'файл уже есть' }); continue; }
    todo.push({ id, url });
  }
  console.log(`В справочнике ${catalog.length} предметов, нужно скачать ${todo.length}`);

  let saved = 0, failed = 0, failStreak = 0, aborted = false;
  if (todo.length) {
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({ locale: 'ru-RU' });
      const home = await context.newPage();
      const nav = await context.newPage();
      try {
        await home.goto('https://www.lowadi.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(5000);
      } catch (e) {
        console.log(`Прогрев не удался: ${String(e.message).slice(0, 160)}`);
      }
      for (const { id, url } of todo) {
        if (failStreak >= FAIL_LIMIT) { aborted = true; break; }
        const result = await download(nav, home, url);
        if (result.body) {
          await writeFile(`${IMAGE_DIR}/${id}.png`, result.body);
          saved++; failStreak = 0;
          results.push({ id, url, status: 'saved', method: result.method, bytes: result.body.length });
          console.log(`+ ${id} (${result.method}, ${result.body.length} байт)`);
        } else {
          failed++; failStreak++;
          results.push({ id, url, status: 'failed', reason: result.error });
          console.log(`- ${id}: ${result.error}`);
        }
        await sleep(PAUSE_MS);
      }
    } finally {
      await browser.close().catch(() => {});
    }
  }

  const notTried = todo.length - saved - failed;
  const summary = [
    `Предметов в справочнике: ${catalog.length}`,
    `Нужно было скачать: ${todo.length}`,
    `Скачано: ${saved}`,
    `Не удалось: ${failed}`,
    `Не обработано из-за остановки: ${notTried}`,
    `Остановлено после ${FAIL_LIMIT} неудач подряд: ${aborted ? 'да' : 'нет'}`
  ].join('\n');
  console.log(summary);
  await writeFile(`${REPORT_DIR}/report.json`, JSON.stringify({ saved, failed, notTried, aborted, results }, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Загрузка картинок\n\n${summary.replaceAll('\n', '  \n')}\n`);
  }
  if (failed || aborted) process.exitCode = 1;
}

main().catch(async e => {
  console.error(e.message);
  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(`${REPORT_DIR}/failure.json`, JSON.stringify({ error: e.message, results }, null, 2));
  process.exitCode = 1;
});
