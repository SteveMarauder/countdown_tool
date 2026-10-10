import { DatabaseSync } from 'node:sqlite';
// 本機開發使用與 D1 相同的 SQLite SQL；正式環境直接使用 D1 binding。
export function openDB(path) {
  const db = new DatabaseSync(path);
  const prepare = sql => {
    let values = [];
    const statement = {
      bind(...args) { values = args; return statement; },
      async first() { return db.prepare(sql).get(...values) || null; },
      async all() { return { results: db.prepare(sql).all(...values) }; },
      async run() {
        if (/RETURNING/i.test(sql)) return { results: db.prepare(sql).all(...values), meta: { changes: Number(db.prepare('SELECT changes() AS n').get().n) } };
        const result = db.prepare(sql).run(...values); return { results: [], meta: { changes: Number(result.changes) } };
      }
    };
    return statement;
  };
  return {
    prepare,
    async batch(statements) {
      db.exec('BEGIN IMMEDIATE');
      try { const results = []; for (const s of statements) results.push(await s.run()); db.exec('COMMIT'); return results; }
      catch(e) { db.exec('ROLLBACK'); throw e; }
    },
    exec: sql => db.exec(sql), close: () => db.close()
  };
}
