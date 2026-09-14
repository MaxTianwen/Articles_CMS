const fs = require('node:fs/promises');
const path = require('node:path');
const { createPool } = require('../lib/database');
async function main() {
    const pool = createPool();
    try {
        await pool.query(
            await fs.readFile(
                path.join(__dirname, '../migrations/001_admin_cms.sql'),
                'utf8',
            ),
        );
        const legacy = await pool.query(
            'SELECT COUNT(*)::int AS count FROM articles a LEFT JOIN categories c ON c.id=a.category WHERE c.id IS NULL OR a.title IS NULL OR length(trim(a.title)) NOT BETWEEN 1 AND 200 OR a.author IS NULL OR length(trim(a.author)) NOT BETWEEN 1 AND 100 OR a.content IS NULL OR length(trim(a.content)) NOT BETWEEN 1 AND 50000 OR a.published IS NULL',
        );
        if (legacy.rows[0].count)
            console.log(
                `Migration complete. ${legacy.rows[0].count} legacy articles need review before validating constraints. No article values were changed.`,
            );
        else {
            await pool.query(
                'ALTER TABLE articles VALIDATE CONSTRAINT articles_category_fk; ALTER TABLE articles VALIDATE CONSTRAINT articles_required_fields',
            );
            console.log('Migration complete; data constraints validated.');
        }
    } finally {
        await pool.end();
    }
}
main().catch((error) => {
    console.error(
        'Migration failed:',
        error.code || error.name,
        'Check the target database and migration requirements.',
    );
    process.exitCode = 1;
});
