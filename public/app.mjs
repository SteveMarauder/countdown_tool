import { UtcClock, remaining, digits } from './core.mjs';
const $ = id => document.getElementById(id);
const cfg = window.CLOCK_CONFIG || {};
const apiBase = String(cfg.apiBase || '').replace(/\/$/, '');
const namespace = `cdtt-clock:${apiBase || location.origin}`;
const clock = new UtcClock();
let event, token, username, pending = false, synchronizing = false, connected = false, calibrated = false, lastSync = 0, source = '', uncertainty = 0;
let adminView = 'official', confirmedRevision = null, confirmedDeadline;
function setAdminView(view) {
  adminView = token && view === 'setup' ? 'setup' : 'official';
  $('setup-screen').hidden = adminView !== 'setup';
  $('official-screen').hidden = adminView === 'setup';
  $('admin-stage').hidden = !token || adminView !== 'official';
  document.body.classList.toggle('editing', adminView === 'setup');
  updateButtons();
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function preview() {
  $('preview-title').textContent = $('title-input').value || '賽事名稱';
  $('preview-subtitle').textContent = $('subtitle-input').value || '準備好，讓創意開始。';
  const parts = ['duration-hours','duration-minutes','duration-seconds'].map(id => String(Math.max(0, Number($(id).value) || 0)).padStart(2,'0'));
  $('preview-time').replaceChildren();
  parts.forEach((part,i) => { if(i) { const colon = document.createElement('span'); colon.textContent = ':'; $('preview-time').append(colon); } $('preview-time').append(document.createTextNode(part)); });
}
const dateFormat = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
function store(key, value) { try { localStorage.setItem(namespace + key, JSON.stringify(value)); } catch { /* 儲存空間不足不影響已開啟畫面的倒數 */ } }
function read(key) { try { return JSON.parse(localStorage.getItem(namespace + key)); } catch { return null; } }
const cache = read(':state');
if (cache?.event && Number.isSafeInteger(cache.event.revision)) event = cache.event;
const anchor = read(':clock');
if (Number.isFinite(anchor?.offset)) clock.restore(anchor.offset);
function accept(next, persist = true) {
  if (!next || !Number.isSafeInteger(next.revision) || (event && next.revision < event.revision)) return;
  const changed = !event || next.revision !== event.revision;
  event = next;
  if (persist && changed) store(':state', { event, savedAt: Date.now() });
  if (changed) populate();
  render();
}
async function api(path, options = {}) {
  const headers = { ...options.headers };
  if (options.body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(apiBase + path, { ...options, headers, cache: 'no-store', signal: AbortSignal.timeout(10000) });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/login') { token = null; username = ''; showAuth(); }
    const err = new Error(data.error || '服務回應異常。'); err.status = response.status; throw err;
  }
  return data;
}
async function loadEvent() {
  try { const data = await api('/api/event'); accept(data.event); connected = true; }
  catch { connected = false; }
  render();
}
async function sync() {
  if (synchronizing) return;
  synchronizing = true; $('sync').disabled = true;
  try {
    // 三次取樣選用往返時間最短的一次，減少網路延遲的影響。
    const samples = [];
    for (let i = 0; i < 3; i++) {
      const sent = performance.now();
      try { const data = await api('/api/time'); const received = performance.now(); if (Number.isFinite(data.now)) samples.push({ sent, received, data }); } catch { /* 下一個樣本或離線錨點 */ }
    }
    if (!samples.length) throw new Error('校時失敗');
    samples.sort((a,b) => (a.received-a.sent) - (b.received-b.sent));
    const s = samples[0];
    const offset = clock.calibrate(s.data.now, s.sent, s.received);
    calibrated = true; lastSync = Date.now(); source = s.data.source;
    uncertainty = clock.uncertainty + (s.data.uncertainty_ms || 0);
    store(':clock', { offset, syncedAt: lastSync, source });
  } catch { calibrated = false; }
  await loadEvent();
  synchronizing = false; $('sync').disabled = false; render();
}
function render() {
  const ms = remaining(event, clock.now());
  const values = event ? digits(ms) : ['--','--','--'];
  ['hours','minutes','seconds'].forEach((id,i) => { if ($(id).textContent !== values[i]) $(id).textContent = values[i]; });
  if (event) {
    $('event-title').textContent = event.title; $('subtitle').textContent = event.subtitle;
    $('phase').textContent = event.status === 'idle' ? '賽事待命' : event.status === 'paused' ? '賽事暫停' : ms <= 0 ? '時間到 · 請停止作答' : '比賽進行中';
    $('deadline').textContent = event.status === 'running' ? dateFormat.format(event.deadline_ms) : event.status === 'paused' ? '暫停中 · 繼續後重新計算截止時間' : '尚未開始';
    $('progress-fill').style.width = `${Math.min(100,Math.max(0,ms / event.duration_ms * 100))}%`;
    document.body.classList.toggle('ending', event.status === 'running' && ms > 0 && ms <= 300000);
    document.body.classList.toggle('finished', event.status === 'running' && ms <= 0);
  }
  const fresh = calibrated && Date.now() - lastSync < 120000;
  $('signal').classList.toggle('online', connected && fresh);
  $('connection').textContent = connected ? fresh ? '已連線 · UTC 已校準' : '已連線 · 待校時' : '離線 · 自動重連中';
  $('clock-info').textContent = calibrated ? `${source} · ${dateFormat.format(lastSync)} · 網路估計 ±${Math.round(uncertainty)}ms` : anchor ? '使用上次校時資料 · 等待重新確認 UTC' : '尚未確認 UTC 時間';
  $('notice').textContent = !event ? '尚未取得賽事資料。請確認後端網址與資料庫已設定。' : !connected ? '連線中斷，依最後儲存的賽事設定持續倒數；期間管理者的異動將在重連後更新。' : !fresh ? '正在等待 UTC 校準。若剛從離線狀態重新開啟，顯示時間暫供參考。' : source === 'local-development' ? '本機測試模式 · 正式部署後使用 Cloudflare 與外部 UTC 校時。' : source?.includes('暫不可用') ? '外部校時服務暫不可用，目前以 Cloudflare UTC 校準。' : '';
  updateButtons();
}
function populate() {
  if (!event) return;
  $('title-input').value = event.title; $('subtitle-input').value = event.subtitle;
  const d = digits(event.duration_ms);
  ['duration-hours','duration-minutes','duration-seconds'].forEach((id,i) => $(id).value = Number(d[i]));
  preview();
  updateButtons();
}
function updateButtons() {
  const unlocked = !!token && connected && !pending && !!event;
  const idle = event?.status === 'idle';
  for (const id of ['title-input','subtitle-input','duration-fields','save-settings','target-time']) $(id).disabled = !unlocked || !idle;
  $('start').disabled = !unlocked || !idle || confirmedRevision !== event?.revision;
  $('start').hidden = !idle;
  $('edit-settings').hidden = !idle;
  $('edit-settings').disabled = !unlocked || !idle;
  $('pause').hidden = event?.status !== 'running' || remaining(event, clock.now()) <= 0;
  $('resume').hidden = event?.status !== 'paused';
  $('reset').hidden = idle;
  $('stage-title').textContent = idle ? confirmedRevision === event?.revision ? '設定已確認 · 準備開賽' : '請先確認賽事設定' : event?.status === 'paused' ? '賽事暫停中' : remaining(event, clock.now()) <= 0 ? '賽事時間已結束' : '正式賽事進行中';
  $('stage-note').textContent = idle ? confirmedRevision !== event?.revision ? '前往修改設定，確認後即可正式開賽。' : confirmedDeadline ? `已設定截止時間：${dateFormat.format(confirmedDeadline)}（台北時間）` : '現場準備完成後，按下正式開賽才會開始倒數。' : '控制操作將同步至所有觀眾畫面。';
  $('pause').disabled = !unlocked || event?.status !== 'running' || remaining(event, clock.now()) <= 0;
  $('resume').disabled = !unlocked || event?.status !== 'paused';
  $('reset').disabled = !unlocked || idle;
}
function showAuth() {
  $('login-form').hidden = !!token; $('controls').hidden = !token;
  $('admin-user').textContent = username ? `管理者：${username}` : '';
  $('admin-open').textContent = token ? '管理中心' : '管理者登入'; updateButtons();
  if (!token) { confirmedRevision = null; confirmedDeadline = undefined; setAdminView('official'); }
}
async function audit() {
  if (!token) return;
  try {
    const data = await api('/api/audit'); $('audit').replaceChildren();
    const labels = { configure: '儲存設定', start: '開始', pause: '暫停', resume: '繼續', reset: '重設' };
    for (const entry of data.entries) { const li = document.createElement('li'); li.textContent = `${dateFormat.format(entry.created_at)} · ${entry.username} · ${labels[entry.action] || entry.action}`; $('audit').append(li); }
  } catch(e) { $('admin-message').textContent = e.message; }
}
async function act(action, input = {}) {
  if (pending) return false;
  pending = true; updateButtons(); $('admin-message').textContent = $('stage-message').textContent = '正在儲存，請稍候…';
  try {
    const data = await api('/api/action', { method: 'POST', body: JSON.stringify({ action, revision: event.revision, ...input }) });
    accept(data.event); $('admin-message').textContent = $('stage-message').textContent = '已儲存，其他顯示器將於 5 秒內更新。'; await audit(); await sync();
    return true;
  } catch(e) {
    $('admin-message').textContent = e.status ? e.message : '無法確認操作是否成功，正在重新讀取賽事。請確認目前狀態後再操作。';
    await loadEvent();
    $('stage-message').textContent = $('admin-message').textContent;
    return false;
  } finally { pending = false; updateButtons(); }
}
function confirmAction(title, text) {
  $('confirm-title').textContent = title; $('confirm-text').textContent = text;
  $('confirm-dialog').showModal();
  return new Promise(resolve => {
    const finish = value => { $('confirm-dialog').close(); $('confirm-ok').onclick = null; $('confirm-cancel').onclick = null; $('confirm-dialog').removeEventListener('cancel', cancel); resolve(value); };
    const cancel = e => { e.preventDefault(); finish(false); };
    $('confirm-ok').onclick = () => finish(true); $('confirm-cancel').onclick = () => finish(false); $('confirm-dialog').addEventListener('cancel', cancel);
  });
}
$('admin-open').onclick = () => { if(token) { populate(); setAdminView(event?.status === 'idle' ? 'setup' : 'official'); audit(); return; } $('login-message').textContent = ''; showAuth(); $('admin-dialog').showModal(); };
$('admin-close').onclick = () => $('admin-dialog').close();
$('login-form').onsubmit = async e => {
  e.preventDefault(); const button = e.currentTarget.querySelector('button'); button.disabled = true;
  $('login-message').textContent = '正在登入…';
  try {
    const fields = new FormData(e.currentTarget);
    const data = await api('/api/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(fields)) });
    token = data.token; username = data.username; e.target.reset(); showAuth(); await loadEvent(); populate(); await audit(); $('admin-message').textContent = ''; $('admin-dialog').close(); setAdminView(event?.status === 'idle' ? 'setup' : 'official');
  } catch(error) { $('login-message').textContent = error.message; }
  finally { button.disabled = false; }
};
$('logout').onclick = async () => {
  try { await api('/api/logout', { method: 'POST' }); token = null; username = ''; showAuth(); $('admin-message').textContent = '已登出。'; }
  catch { $('admin-message').textContent = '無法通知伺服器登出，請恢復連線後再試。'; }
};
$('stage-logout').onclick = $('logout').onclick;
$('settings-form').onsubmit = async e => {
  e.preventDefault();
  const numbers = ['duration-hours','duration-minutes','duration-seconds'].map(id => Number($(id).value));
  if (numbers.some(n => !Number.isInteger(n))) { $('admin-message').textContent = '請輸入整數時間。'; return; }
  const target = $('target-time').value;
  const deadline = target ? Date.parse(`${target}+08:00`) : undefined;
  if (target && (!Number.isFinite(deadline) || deadline <= clock.now() || deadline-clock.now()>168*3600000)) { $('admin-message').textContent = '截止時間必須在未來 168 小時內（台北時間）。'; return; }
  if(await act('configure', { title: $('title-input').value, subtitle: $('subtitle-input').value, duration_ms: (numbers[0]*3600+numbers[1]*60+numbers[2])*1000 })) { confirmedRevision = event.revision; confirmedDeadline = deadline; setAdminView('official'); }
};
$('settings-form').addEventListener('input', preview);
$('edit-settings').onclick = () => { populate(); setAdminView('setup'); };
$('return-to-clock').onclick = () => setAdminView('official');
$('start').onclick = async () => {
  const deadline_ms = confirmedDeadline;
  if (confirmedRevision !== event.revision) return;
  if (deadline_ms && deadline_ms <= clock.now()) { $('stage-message').textContent = '指定截止時間已過，請返回修改賽事設定。'; return; }
  if (await confirmAction('確認正式開賽', deadline_ms ? `所有顯示器將倒數至台北時間 ${dateFormat.format(deadline_ms)}。確認現場準備完成後再開賽。` : `所有顯示器將開始 ${digits(event.duration_ms).join(':')} 的倒數。確認現場準備完成後再開賽。`)) await act('start', { deadline_ms });
};
$('pause').onclick = async () => { if (await confirmAction('暫停賽事', '所有顯示器將保留剩餘時間，繼續後截止時間會延後。')) await act('pause'); };
$('resume').onclick = () => act('resume');
$('reset').onclick = async () => { if (await confirmAction('重設賽事', '目前的倒數進度將清除，並回到原設定時長的待命狀態。')) { if(await act('reset')) { $('target-time').value = ''; confirmedRevision = null; confirmedDeadline = undefined; setAdminView('setup'); } } };
$('sync').onclick = sync;
$('fullscreen').onclick = async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
  catch { $('notice').textContent = '瀏覽器未允許全螢幕，請使用瀏覽器的全螢幕功能。'; }
};
document.addEventListener('fullscreenchange', () => { document.body.classList.toggle('projection', !!document.fullscreenElement); $('fullscreen').textContent = document.fullscreenElement ? '退出全螢幕 ↙' : '全螢幕 ↗'; window.scrollTo({top:0,behavior:'instant'}); });
window.addEventListener('online', () => { calibrated = false; sync(); });
window.addEventListener('offline', () => { connected = false; render(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { calibrated = false; sync(); } });
window.addEventListener('pageshow', e => { if (e.persisted) { calibrated = false; sync(); } });
window.addEventListener('storage', e => { if (e.key === namespace + ':state') { const data = read(':state'); if (data?.event) accept(data.event, false); } });
showAuth(); populate(); render(); sync();
setInterval(render, 200);
setInterval(loadEvent, cfg.pollMs || 5000);
setInterval(sync, cfg.syncMs || 60000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
