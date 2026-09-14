// Explicit local-only sample workspace. Never reads .env or connects to Neon.
const { randomBytes, randomUUID } = require('node:crypto');
const { testDatabase } = require('../tests/helpers');
const { hashPassword } = require('../lib/auth');
const { createContentService } = require('../content-service');
const { createApp } = require('../app');
async function main() {
    const { pool } = await testDatabase();
    const images = new Map();
    const imageService = {
        async upload(buffer) {
            const publicId = randomUUID();
            images.set(publicId, buffer);
            return { url: '/demo-images/' + publicId + '.webp', publicId };
        },
        async remove(id) {
            images.delete(id);
        },
    };
    await pool.query(
        'INSERT INTO admins (username,password_hash) VALUES ($1,$2)',
        ['demo', await hashPassword('Folio-demo-only-2026!')],
    );
    const service = createContentService(pool);
    const samples = [
        ['The art of building something simple', 1, true],
        ['A quieter approach to web design', 2, true],
        ['What happens after you click Save', 1, true],
        ['Designing for the way people read', 2, false],
        ['Notes from a PostgreSQL migration', 3, true],
        ['A small guide to better API errors', 1, false],
        ['Making space for your next idea', 2, true],
        ['From a blank page to a working project', 3, false],
    ];
    for (let i = samples.length - 1; i >= 0; i--) {
        const [title, category, published] = samples[i];
        const article = await service.addArticle({
            title,
            category,
            published,
            author: i % 2 ? 'Jamie Chen' : 'Alex Morgan',
            content:
                'This is a sample article in the local CONTENT DESK demo. It is here to help you explore the layout and editing experience.\n\nGood tools make the next step feel clear. A useful starting point is to focus on what someone is trying to do, give them the information they need, and make the result of each action easy to understand.\n\nTry editing the title, changing the category, or adding a cover image. Your changes stay in this isolated local demo and disappear when the demo restarts.',
        });
        await pool.query(
            'UPDATE articles SET "articleDate"=$1, updated_at=$2 WHERE id=$3',
            [
                '2026-09-' + String(13 - i).padStart(2, '0'),
                '2026-09-' + String(13 - i).padStart(2, '0') + 'T12:00:00Z',
                article.id,
            ],
        );
    }
    const app = createApp({
        pool,
        images: imageService,
        env: {
            SESSION_SECRET: randomBytes(48).toString('hex'),
            NODE_ENV: 'development',
        },
        demo: true,
    });
    // Disposable demo images are local-only; never real project assets.
    const express = require('express'),
        wrapper = express();
    wrapper.use('/demo-images', (req, res) => {
        // These are disposable local demo uploads, not real project assets.
        const id = req.path.slice(1).replace(/\.webp$/, '');
        const buffer = images.get(id);
        if (!buffer) return res.sendStatus(404);
        res.set('Cache-Control', 'no-store').type('image/webp').send(buffer);
    });
    wrapper.use(app);
    const server = wrapper.listen(3839, '127.0.0.1', () =>
        console.log(
            'Local demo: http://127.0.0.1:3839 | Username: demo | Password: Folio-demo-only-2026! | No external database.',
        ),
    );
    for (const signal of ['SIGINT', 'SIGTERM'])
        process.on(signal, () =>
            server.close(async () => {
                await pool.end();
                process.exit(0);
            }),
        );
}
main().catch((error) => {
    console.error('Demo failed:', error.message);
    process.exitCode = 1;
});
