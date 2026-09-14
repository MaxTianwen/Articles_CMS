const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const sharp = require('sharp');
const { testDatabase, validArticle } = require('./helpers');
const { createContentService } = require('../content-service');
const { createApp } = require('../app');
const { hashPassword } = require('../lib/auth');
let pool,
    app,
    agent,
    token,
    article,
    uploaded = 0,
    cleaned = [];
const csrfFrom = (html) =>
    html.match(/name="_csrf" value="([a-f0-9]+)"/)?.[1] ||
    html.match(/name="csrf-token" content="([a-f0-9]+)"/)?.[1];
before(async () => {
    ({ pool } = await testDatabase());
    await pool.query(
        'INSERT INTO admins (username,password_hash) VALUES ($1,$2)',
        ['admin', await hashPassword('A-safe-test-password-2026!')],
    );
    article = await createContentService(pool).addArticle({
        ...validArticle,
        featureImage:
            'https://res.cloudinary.com/demo/image/upload/original.webp',
        featureImagePublicId: 'original',
    });
    app = createApp({
        pool,
        env: {
            SESSION_SECRET: 'a-test-secret-that-is-long-and-only-for-tests',
            NODE_ENV: 'test',
        },
        images: {
            async upload() {
                uploaded++;
                return {
                    url: 'https://res.cloudinary.com/demo/image/upload/new.webp',
                    publicId: 'new-' + uploaded,
                };
            },
            async remove(id) {
                cleaned.push(id);
            },
        },
    });
    agent = request.agent(app);
    const page = await agent.get('/login');
    const login = await agent
        .post('/login')
        .type('form')
        .send({
            _csrf: csrfFrom(page.text),
            username: 'admin',
            password: 'A-safe-test-password-2026!',
        });
    assert.equal(login.status, 303);
    token = csrfFrom((await agent.get('/')).text);
});
after(async () => pool.end());
function save(id, overrides = {}) {
    return agent
        .put('/articles/' + id)
        .set('Accept', 'application/json')
        .set('X-CSRF-Token', token)
        .field('title', overrides.title ?? 'Revised article')
        .field('content', 'Updated content.')
        .field('author', 'Alex')
        .field('category', overrides.category || '1')
        .field('published', overrides.published || 'true');
}
test('breadcrumbs show the current page and link only to its ancestors', async () => {
    for (const [path, label, parents] of [
        ['/', 'Home', []],
        ['/articles', 'Articles', ['/']],
        ['/articles?view=gallery', 'Articles', ['/']],
        ['/categories', 'Categories', ['/']],
        ['/about', 'About', ['/']],
        ['/articles/add', 'New article', ['/', '/articles']],
        ['/articles/' + article.id, 'Article preview', ['/', '/articles']],
        ['/articles/' + article.id + '/edit', 'Edit article', ['/', '/articles']],
    ]) {
        const page = await agent.get(path);
        assert.equal(page.status, 200);
        const breadcrumb = page.text.match(/<nav class="breadcrumb-nav"[\s\S]*?<\/nav>/)?.[0];
        assert.ok(breadcrumb);
        assert.ok(breadcrumb.includes('<span aria-current="page">' + label + '</span>'));
        assert.equal((breadcrumb.match(/aria-current="page"/g) || []).length, 1);
        const links = Array.from(breadcrumb.matchAll(/href="([^"]+)"/g), match => match[1]);
        assert.deepEqual(links, parents);
        assert.doesNotMatch(page.text, /class="topbar-nav"/);
    }
});

test('administrator pages use uppercase branding and task-focused copy', async () => {
    const home = await agent.get('/');
    assert.match(home.text, />CONTENT DESK</);
    assert.match(home.text, /<h1>Content overview<\/h1>/);
    assert.match(home.text, /Manage articles/);
    assert.match(home.text, /Review unpublished/);
    assert.doesNotMatch(
        home.text,
        /Your next story starts here|FROM FIRST IDEA TO FINAL DRAFT|Still in the making/,
    );
    const login = await request(app).get('/login');
    assert.match(login.text, /Administrator sign-in/);
    assert.match(login.text, />CONTENT DESK</);
    const about = await agent.get('/about');
    assert.match(about.text, /<title>About · CONTENT DESK<\/title>/);
    assert.match(about.text, />\s*About<\/a>/);
    assert.doesNotMatch(about.text, /About this CMS|FOLIO/);
});

test('anonymous pages redirect and every article API/write is protected', async () => {
    for (const path of [
        '/',
        '/articles',
        '/categories',
        '/articles/add',
        '/articles/1/edit',
    ])
        assert.equal((await request(app).get(path)).status, 302);
    assert.equal((await request(app).get('/api/articles/1')).status, 401);
    assert.equal(
        (
            await request(app)
                .post('/articles/add')
                .set('Accept', 'application/json')
        ).status,
        401,
    );
    assert.equal((await request(app).put('/articles/1')).status, 401);
    assert.equal((await request(app).delete('/articles/1')).status, 401);
});
test('all main pages render using the protected Tabler layout', async () => {
    for (const path of [
        '/',
        '/articles',
        '/articles?view=gallery',
        '/categories',
        '/about',
        '/articles/add',
        '/articles/' + article.id,
        '/articles/' + article.id + '/edit',
    ]) {
        const response = await agent.get(path);
        assert.equal(
            response.status,
            200,
            path + ': ' + response.text.slice(0, 100),
        );
        assert.match(response.text, /\/vendor\/tabler\/css\/tabler.min.css/);
        assert.ok(
            response.headers['content-security-policy'].includes(
                "script-src 'self'",
            ),
        );
    }
    assert.equal(
        (await request(app).get('/vendor/tabler/css/tabler.min.css')).status,
        200,
    );
});
test('login errors are generic; login CSRF is required', async () => {
    const anonymous = request.agent(app),
        page = await anonymous.get('/login');
    const invalid = await anonymous
        .post('/login')
        .type('form')
        .send({
            _csrf: csrfFrom(page.text),
            username: 'admin',
            password: 'wrong',
        });
    assert.equal(invalid.status, 401);
    assert.match(invalid.text, /username or password is incorrect/);
    assert.equal(
        (
            await anonymous
                .post('/login')
                .type('form')
                .send({ username: 'admin', password: 'wrong' })
        ).status,
        403,
    );
});
test('CSRF is required, including malformed unicode tokens', async () => {
    assert.equal((await agent.delete('/articles/' + article.id)).status, 403);
    assert.equal(
        (
            await agent
                .delete('/articles/' + article.id)
                .send({ _csrf: '界'.repeat(64) })
        ).status,
        403,
    );
});
test('editing preserves image and date, and published remains true', async () => {
    assert.equal((await save(article.id)).status, 200);
    const response = await agent.get('/api/articles/' + article.id);
    assert.equal(response.body.published, true);
    assert.equal(response.body.featureImage, article.featureImage);
    assert.equal(
        response.body.articleDate,
        (
            await pool.query(
                'SELECT "articleDate"::text AS date FROM articles WHERE id=$1',
                [article.id],
            )
        ).rows[0].date,
    );
    assert.equal(uploaded, 0);
});
test('invalid fields, missing records and invalid dates have specific statuses', async () => {
    const invalid = await save(article.id, { title: ' ' });
    assert.equal(invalid.status, 400);
    assert.ok(invalid.body.fields.title);
    assert.equal((await save(article.id, { category: '999' })).status, 400);
    assert.equal((await agent.get('/api/articles/9999')).status, 404);
    assert.equal((await save('invalid')).status, 400);
    assert.equal((await agent.get('/articles?minDate=2026-02-30')).status, 400);
});
test('unpublished content is visible to admins; text is escaped in EJS and preview uses textContent', async () => {
    const title = '<script>alert("xss")</script>';
    const result = await save(article.id, { title, published: 'false' });
    assert.equal(result.status, 200);
    const page = await agent.get('/articles/' + article.id);
    assert.equal(page.status, 200);
    assert.ok(!page.text.includes(title));
    assert.match(page.text, /&lt;script&gt;/);
    const source = await request(app).get('/js/admin.js');
    assert.match(source.text, /preview-content'\).textContent/);
});
test('fake image content and oversized images are rejected without uploading', async () => {
    const fake = await save(article.id).attach(
        'featureImage',
        Buffer.from('not an image'),
        { filename: 'fake.png', contentType: 'image/png' },
    );
    assert.equal(fake.status, 400);
    assert.equal(uploaded, 0);
    const large = await save(article.id).attach(
        'featureImage',
        Buffer.alloc(5 * 1024 * 1024 + 1),
        { filename: 'large.png', contentType: 'image/png' },
    );
    assert.equal(large.status, 413);
    assert.equal(uploaded, 0);
});
test('valid image is decoded and uploaded; replacing/removing it cleans tracked assets', async () => {
    const png = await sharp({
        create: { width: 8, height: 8, channels: 3, background: '#336699' },
    })
        .png()
        .toBuffer();
    const result = await save(article.id).attach('featureImage', png, {
        filename: 'cover.png',
        contentType: 'image/png',
    });
    assert.equal(result.status, 200);
    assert.equal(uploaded, 1);
    assert.ok(cleaned.includes('original'));
    assert.equal(
        (await save(article.id).field('removeImage', 'true')).status,
        200,
    );
    assert.equal(
        (await agent.get('/api/articles/' + article.id)).body.featureImage,
        null,
    );
    assert.ok(cleaned.includes('new-1'));
});
test('creation and deletion return expected statuses and data persists between requests', async () => {
    const created = await agent
        .post('/articles/add')
        .set('Accept', 'application/json')
        .set('X-CSRF-Token', token)
        .field('title', 'Created in test')
        .field('content', 'Body')
        .field('author', 'Admin')
        .field('category', '2')
        .field('published', 'false');
    assert.equal(created.status, 201);
    assert.equal(
        (await agent.get('/api/articles/' + created.body.id)).body.title,
        'Created in test',
    );
    assert.equal(
        (
            await agent
                .delete('/articles/' + created.body.id)
                .set('X-CSRF-Token', token)
        ).status,
        200,
    );
    assert.equal(
        (await agent.get('/api/articles/' + created.body.id)).status,
        404,
    );
});
test('logout destroys session and old cookie cannot access the API', async () => {
    const loggedOut = await agent
        .post('/logout')
        .type('form')
        .send({ _csrf: token });
    assert.equal(loggedOut.status, 303);
    assert.equal((await agent.get('/api/articles/' + article.id)).status, 401);
});
