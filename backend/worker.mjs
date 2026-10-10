import { transition } from '../public/core.mjs';

const enc = new TextEncoder();
export const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
export async function digest(value) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(value))); }
export async function passwordHash(password, salt, iterations = 100000) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations }, key, 256));
}
function equal(a, b) { let d = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return d === 0; }
let timeReference;
async function utc(env) {
  if (env.LOCAL_DEV) return { now: Date.now(), source: 'local-development', checked_at: Date.now(), uncertainty_ms: 1 };
  if (!timeReference || Date.now() - timeReference.checked_at > 60000) {
    const start = Date.now();
    try {
      const res = await fetch('https://worldtimeapi.org/api/timezone/Etc/UTC', { signal: AbortSignal.timeout(2500), headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('UTC provider unavailable');
      const data = await res.json();
      const end = Date.now();
      const stamp = Date.parse(data.utc_datetime);
      // 外部服務回傳異常時使用平台 UTC，避免單一時間來源破壞正式賽事。
      if (!Number.isFinite(stamp) || Math.abs(stamp - end) > 10000) throw new Error('UTC provider outlier');
      timeReference = { offset: stamp + (end - start) / 2 - end, source: 'worldtimeapi.org / UTC', checked_at: end, uncertainty_ms: (end - start) / 2 };
    } catch {
      timeReference = { offset: 0, source: 'Cloudflare UTC（外部校時暫不可用）', checked_at: Date.now(), uncertainty_ms: null };
    }
  }
  return { now: Date.now() + timeReference.offset, source: timeReference.source, checked_at: timeReference.checked_at, uncertainty_ms: timeReference.uncertainty_ms };
}
function reply(data, status, cors) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
async function body(request) {
  const text = await request.text();
  if (text.length > 4096) throw new Error('請求過大。');
  return JSON.parse(text);
}
async function session(request, env) {
  const token = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token) return null;
  return env.DB.prepare('SELECT username FROM sessions WHERE token_hash = ? AND expires_at > ?').bind(await digest(token), Date.now()).first();
}
async function handle(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim());
  const cors = { 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600' };
  if (origin && !allowed.includes(origin)) return reply({ error: '來源未授權。' }, 403, {});
  if (origin) cors['Access-Control-Allow-Origin'] = origin;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const url = new URL(request.url);
  try {
    if (url.pathname === '/api/time' && request.method === 'GET') return reply(await utc(env), 200, cors);
    if (url.pathname === '/api/event' && request.method === 'GET') {
      const state = await env.DB.prepare('SELECT * FROM event WHERE id = 1').first();
      if (!state) return reply({ error: '資料庫尚未初始化。' }, 503, cors);
      return reply({ event: state }, 200, cors);
    }
    if (url.pathname === '/api/login' && request.method === 'POST') {
      const input = await body(request);
      const username = String(input.username || '').trim();
      const password = String(input.password || '');
      if (username.length > 80 || password.length > 256) return reply({ error: '登入資料無效。' }, 400, cors);
      // 每個來源 IP 與每個帳戶都有限制，資料庫保存計數避免 Worker 重啟繞過限制。
      const now = Date.now();
      const keys = ['ip:' + (request.headers.get('CF-Connecting-IP') || 'local'), 'user:' + username];
      const limits = await env.DB.batch(keys.map(key => env.DB.prepare(
        'INSERT INTO login_limits(key,count,window_start) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count = CASE WHEN window_start < ? THEN 1 ELSE count+1 END, window_start = CASE WHEN window_start < ? THEN ? ELSE window_start END RETURNING count'
      ).bind(key, now, now - 900000, now - 900000, now)));
      if (limits.some(x => x.results[0].count > 10)) return reply({ error: '登入嘗試過多，請 15 分鐘後再試。' }, 429, cors);
      const admin = await env.DB.prepare('SELECT * FROM admins WHERE username = ?').bind(username).first();
      const candidate = await passwordHash(password, admin?.salt || 'unknown-account-salt', admin?.iterations || 100000);
      if (!admin || !equal(candidate, admin.password_hash)) return reply({ error: '帳戶或密碼不正確。' }, 401, cors);
      const token = hex(crypto.getRandomValues(new Uint8Array(32)));
      const expires = now + 8 * 3600000;
      await env.DB.prepare('INSERT INTO sessions VALUES (?,?,?)').bind(await digest(token), username, expires).run();
      return reply({ token, username, expires_at: expires }, 200, cors);
    }
    const admin = await session(request, env);
    if (!admin) return reply({ error: '請先登入管理者帳戶。' }, 401, cors);
    if (url.pathname === '/api/logout' && request.method === 'POST') {
      await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await digest(request.headers.get('Authorization').slice(7))).run();
      return reply({ ok: true }, 200, cors);
    }
    if (url.pathname === '/api/audit' && request.method === 'GET') {
      const data = await env.DB.prepare('SELECT username,action,created_at,revision FROM audit ORDER BY id DESC LIMIT 30').all();
      return reply({ entries: data.results }, 200, cors);
    }
    if (url.pathname === '/api/action' && request.method === 'POST') {
      const input = await body(request);
      const current = await env.DB.prepare('SELECT * FROM event WHERE id = 1').first();
      if (!current) return reply({ error: '資料庫尚未初始化。' }, 503, cors);
      if (input.revision !== current.revision) return reply({ error: '賽事已由其他管理者修改，已重新載入，請確認後再操作。' }, 409, cors);
      const { now } = await utc(env);
      const next = transition(current, input.action, input, Math.round(now));
      const results = await env.DB.batch([
        env.DB.prepare('UPDATE event SET title=?,subtitle=?,duration_ms=?,deadline_ms=?,remaining_ms=?,status=?,revision=?,updated_at=? WHERE id=1 AND revision=?').bind(next.title, next.subtitle, next.duration_ms, next.deadline_ms, next.remaining_ms, next.status, next.revision, next.updated_at, current.revision),
        env.DB.prepare('INSERT INTO audit(username,action,created_at,revision) SELECT ?,?,?,? WHERE changes()=1').bind(admin.username, input.action, next.updated_at, next.revision)
      ]);
      if (results[0].meta.changes !== 1) return reply({ error: '另一位管理者剛剛修改了賽事，請重新操作。' }, 409, cors);
      return reply({ event: next }, 200, cors);
    }
    return reply({ error: '找不到此 API。' }, 404, cors);
  } catch (error) {
    if (error instanceof SyntaxError || /請求過大|時間須|賽事名稱|請先重設|只有待命|截止時間|沒有可暫停|沒有暫停|不支援/.test(error.message)) return reply({ error: error.message }, 400, cors);
    console.error('API request failed', url.pathname, error.message);
    return reply({ error: '服務暫時不可用，倒數會繼續；請稍後重試。' }, 503, cors);
  }
}
export default {
  fetch: handle,
  async scheduled(_controller, env) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()),
      env.DB.prepare('DELETE FROM login_limits WHERE window_start < ?').bind(Date.now() - 900000)
    ]);
  }
};
