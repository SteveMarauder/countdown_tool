import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { passwordHash, hex } from '../backend/worker.mjs';
import { openDB } from './sqlite.mjs';
// 密碼只從 stdin 讀取；不接受命令列密碼，不寫入原始密碼。
let text = ''; for await (const chunk of process.stdin) text += chunk;
const { username, password } = JSON.parse(text.replace(/^\uFEFF/, ''));
if (!/^[a-zA-Z0-9_.@-]{3,80}$/.test(username || '')) throw new Error('帳戶須為 3–80 個英數或 _.@- 字元。');
if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new Error('密碼須為 12–256 個字元。');
const salt = hex(crypto.getRandomValues(new Uint8Array(24)));
const hash = await passwordHash(password, salt);
const sql = `DELETE FROM sessions WHERE username='${username}';\nINSERT INTO admins(username,salt,password_hash,iterations) VALUES ('${username}','${salt}','${hash}',100000) ON CONFLICT(username) DO UPDATE SET salt=excluded.salt,password_hash=excluded.password_hash,iterations=excluded.iterations;\n`;
await mkdir('work', { recursive: true });
if (process.argv.includes('--local')) {
  const db = openDB('work/local.sqlite'); db.exec(await readFile('backend/schema.sql', 'utf8')); db.exec(sql); db.close();
  console.log('本機管理者帳戶已建立／更新。');
} else {
  await writeFile('work/admin.sql', sql, { mode: 0o600 });
  console.log('已產生 work/admin.sql（僅含雜湊）。接著執行：npx wrangler d1 execute contest-clock --remote --file=work/admin.sql');
}
