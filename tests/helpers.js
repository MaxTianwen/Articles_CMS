const { PGlite } = require('@electric-sql/pglite');
const fs = require('node:fs/promises');
const path = require('node:path');
async function testDatabase() {
    const db = new PGlite();
    await db.exec(
        await fs.readFile(
            path.join(__dirname, '../migrations/001_admin_cms.sql'),
            'utf8',
        ),
    );
    // pg-compatible adapter for the isolated PostgreSQL WASM engine, never Neon.
    const pool = {
        query(text, values, callback) {
            if (typeof values === 'function') {
                callback = values;
                values = [];
            }
            if (typeof text === 'object') {
                values = text.values;
                text = text.text;
            }
            const promise = db
                .query(text, values || [])
                .then((result) => ({
                    ...result,
                    rowCount: result.affectedRows || result.rows.length,
                }));
            if (callback) {
                promise.then((result) => callback(null, result), callback);
                return;
            }
            return promise;
        },
        end: () => db.close(),
    };
    await pool.query(
        'INSERT INTO categories (id,"Name") VALUES (1,$1),(2,$2),(3,$3)',
        ['Technology', 'Design', 'Learning'],
    );
    return { pool, db };
}
const validArticle = {
    title: 'A useful article',
    content: 'A complete paragraph.',
    author: 'Alex',
    category: 1,
    published: true,
};
module.exports = { testDatabase, validArticle };
