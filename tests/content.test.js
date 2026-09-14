const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { testDatabase, validArticle } = require('./helpers');
const { createContentService } = require('../content-service');
const { validateArticle, parseFilters, parseId } = require('../lib/validation');
let pool, service;
before(async () => {
    ({ pool } = await testDatabase());
    service = createContentService(pool);
});
after(async () => pool.end());
test('multipart true and false parse correctly; missing and duplicate fields are rejected', () => {
    assert.equal(
        validateArticle({ ...validArticle, category: '1', published: 'true' })
            .published,
        true,
    );
    assert.equal(
        validateArticle({ ...validArticle, category: '1', published: 'false' })
            .published,
        false,
    );
    assert.throws(
        () =>
            validateArticle({
                ...validArticle,
                category: '1',
                published: true,
            }),
        { status: 400 },
    );
    assert.throws(
        () =>
            validateArticle({
                ...validArticle,
                title: ['bad'],
                category: '1',
                published: 'true',
            }),
        { status: 400 },
    );
    assert.throws(
        () =>
            validateArticle({
                ...validArticle,
                title: ' ',
                category: '1',
                published: 'true',
            }),
        { status: 400 },
    );
});
test('IDs, real dates and filter types are validated', () => {
    for (const id of ['0', '-1', '1 OR 1=1', '1.5', '2147483648'])
        assert.throws(() => parseId(id), { status: 400 });
    assert.throws(() => parseFilters({ minDate: '2026-02-30' }), {
        status: 400,
    });
    assert.throws(() => parseFilters({ category: ['1', '2'] }), {
        status: 400,
    });
    assert.throws(() => parseFilters({ sort: 'title; DROP TABLE articles' }), {
        status: 400,
    });
});
test('editing preserves stored image and article date; status can change in both directions', async () => {
    const article = await service.addArticle({
        ...validArticle,
        featureImage: 'https://res.cloudinary.com/demo/image/upload/cover.webp',
        featureImagePublicId: 'cover',
    });
    const saved = await service.updateArticle(article.id, {
        ...validArticle,
        title: 'Revised title',
        published: false,
    });
    assert.equal(saved.featureImage, article.featureImage);
    assert.equal(saved.featureImagePublicId, 'cover');
    assert.deepEqual(saved.articleDate, article.articleDate);
    assert.equal(saved.published, false);
    assert.equal(
        (await service.updateArticle(article.id, validArticle)).published,
        true,
    );
    const removed = await service.updateArticle(article.id, {
        ...validArticle,
        featureImage: null,
        featureImagePublicId: null,
    });
    assert.equal(removed.featureImage, null);
});
test('category and date filters compose; SQL parameters keep text literal', async () => {
    const title = "SQL ' OR 1=1 -- lesson";
    await service.addArticle({ ...validArticle, title });
    const result = await service.getArticles(
        parseFilters({
            search: title,
            category: '1',
            minDate: '2000-01-01',
            status: 'published',
        }),
    );
    assert.equal(result.total, 1);
    assert.equal(result.articles[0].title, title);
    assert.equal(
        (await service.getArticles({ search: '100% definitely absent' })).total,
        0,
    );
});
test('missing article is 404, invalid category is 400, and DB FK rejects bypassed validation', async () => {
    await assert.rejects(service.updateArticle(2147483647, validArticle), {
        status: 404,
    });
    await assert.rejects(service.deleteArticle(2147483647), { status: 404 });
    await assert.rejects(service.getArticle(2147483647), { status: 404 });
    await assert.rejects(
        service.addArticle({ ...validArticle, category: 999 }),
        { status: 400 },
    );
    await assert.rejects(
        pool.query(
            'INSERT INTO articles (title,content,author,category,published) VALUES ($1,$2,$3,999,true)',
            ['a', 'b', 'c'],
        ),
        { code: '23503' },
    );
});
test('database errors are not converted into successful empty results or fake 404s', async () => {
    const error = Object.assign(new Error('offline'), { code: 'ECONNREFUSED' });
    const broken = createContentService({
        query: async () => {
            throw error;
        },
    });
    await assert.rejects(broken.getArticle(1), error);
});
test('calendar dates are returned as date-only text, without timezone conversion', async () => {
    const article = await service.addArticle(validArticle);
    await pool.query('UPDATE articles SET "articleDate"=$1 WHERE id=$2', [
        '2026-09-13',
        article.id,
    ]);
    assert.equal(
        (await service.getArticle(article.id)).articleDate,
        '2026-09-13',
    );
});
