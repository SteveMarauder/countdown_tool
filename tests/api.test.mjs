import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker, { passwordHash } from '../backend/worker.mjs';
import { openDB } from '../scripts/sqlite.mjs';
test('完整 API：授權、CAS 並行保護、稽核、重新載入、登出與暴力登入限制', async () => {
  const db = openDB(':memory:'); db.exec(await readFile(new URL('../backend/schema.sql', import.meta.url),'utf8'));
  await db.prepare('INSERT INTO admins VALUES (?,?,?,?)').bind('test-admin','salt',await passwordHash('test-password-123','salt'),100000).run();
  const env = { DB:db,LOCAL_DEV:true,ALLOWED_ORIGINS:'https://test.github.io' };
  async function call(path, method='GET', body, token, origin='https://test.github.io') {
    const res = await worker.fetch(new Request('https://clock.test'+path,{method,headers:{Origin:origin,...(token?{Authorization:'Bearer '+token}:{}),'CF-Connecting-IP':'test-ip'},...(body?{body:JSON.stringify(body)}:{})}),env);
    return { status:res.status, data:await res.json() };
  }
  assert.equal((await call('/api/action','POST',{action:'start',revision:0})).status,401);
  assert.equal((await call('/api/event','GET',null,null,'https://evil.test')).status,403);
  assert.equal((await call('/api/login','POST',{username:'test-admin',password:'wrong'})).status,401);
  const login = await call('/api/login','POST',{username:'test-admin',password:'test-password-123'});
  assert.equal(login.status,200); const token=login.data.token;
  const started = await call('/api/action','POST',{action:'start',revision:0},token);
  assert.equal(started.status,200); assert.equal(started.data.event.status,'running');
  assert.equal((await call('/api/action','POST',{action:'reset',revision:0},token)).status,409);
  const retrieved = await call('/api/event'); assert.equal(retrieved.data.event.deadline_ms,started.data.event.deadline_ms);
  const parallel = await Promise.all([call('/api/action','POST',{action:'pause',revision:1},token),call('/api/action','POST',{action:'reset',revision:1},token)]);
  assert.deepEqual(parallel.map(x=>x.status).sort(),[200,409]);
  const entries = (await call('/api/audit','GET',null,token)).data.entries;
  assert.equal(entries.length,2); assert.equal(entries[0].revision,2);
  assert.equal((await call('/api/time')).status,200);
  assert.equal((await call('/api/logout','POST',{},token)).status,200);
  assert.equal((await call('/api/audit','GET',null,token)).status,401);
  for (let i=0;i<9;i++) await call('/api/login','POST',{username:'test-admin',password:'wrong'});
  assert.equal((await call('/api/login','POST',{username:'test-admin',password:'wrong'})).status,429);
  db.close();
});
