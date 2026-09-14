const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const sharp = require('sharp');
const { testDatabase } = require('./helpers');
const { createApp } = require('../app');
const { createAuth, hashPassword, verifyPassword } = require('../lib/auth');
const { createPool } = require('../lib/database');
let pool, hash;
const env = {
    SESSION_SECRET: 'an-isolated-security-test-secret-over-32-chars',
    NODE_ENV: 'test',
};
const csrfFrom = (text) => text.match(/name="_csrf" value="([a-f0-9]+)"/)?.[1];
before(async () => {
    ({ pool } = await testDatabase());
    hash = await hashPassword('Strong-test-password-2026!');
    await pool.query(
        'INSERT INTO admins(username,password_hash) VALUES ($1,$2)',
        ['security', hash],
    );
});
after(async () => pool.end());
test('passwords use salted slow hashes and incorrect passwords are rejected', async () => {
    assert.ok(!hash.includes('Strong-test-password'));
    assert.equal(
        await verifyPassword('Strong-test-password-2026!', hash),
        true,
    );
    assert.equal(await verifyPassword('wrong', hash), false);
    await assert.rejects(hashPassword('short'));
});
test('shared login counters throttle repeated attempts without hashing each rejected attempt', async () => {
    const auth = createAuth(pool);
    await pool.query(
        "INSERT INTO login_attempts(key,attempts,reset_at) VALUES ($1,10,CURRENT_TIMESTAMP + INTERVAL '15 minutes')",
        [
            'username:' +
                require('node:crypto')
                    .createHash('sha256')
                    .update('blocked')
                    .digest('hex'),
        ],
    );
    await assert.rejects(auth.login('blocked', 'anything', '127.0.0.9'), {
        status: 429,
    });
});
test('production cookies are HttpOnly, Secure and SameSite; login rotates session IDs; logout revokes old cookie', async () => {
    const app = createApp({
        pool,
        images: {},
        env: { ...env, NODE_ENV: 'production', TRUST_PROXY: '1' },
    });
    const page = await request(app)
        .get('/login')
        .set('X-Forwarded-Proto', 'https');
    const oldCookie = page.headers['set-cookie'][0].split(';')[0];
    assert.match(page.headers['set-cookie'][0], /HttpOnly/);
    assert.match(page.headers['set-cookie'][0], /Secure/);
    assert.match(page.headers['set-cookie'][0], /SameSite=Lax/);
    const login = await request(app)
        .post('/login')
        .set('X-Forwarded-Proto', 'https')
        .set('Cookie', oldCookie)
        .type('form')
        .send({
            _csrf: csrfFrom(page.text),
            username: 'security',
            password: 'Strong-test-password-2026!',
        });
    assert.equal(login.status, 303);
    const loggedInCookie = login.headers['set-cookie'][0].split(';')[0];
    assert.notEqual(loggedInCookie, oldCookie);
    assert.equal(
        (
            await request(app)
                .get('/api/articles/1')
                .set('Cookie', oldCookie)
                .set('X-Forwarded-Proto', 'https')
        ).status,
        401,
    );
    const home = await request(app)
        .get('/')
        .set('Cookie', loggedInCookie)
        .set('X-Forwarded-Proto', 'https');
    const logout = await request(app)
        .post('/logout')
        .set('Cookie', loggedInCookie)
        .set('X-Forwarded-Proto', 'https')
        .type('form')
        .send({ _csrf: csrfFrom(home.text) });
    assert.equal(logout.status, 303);
    assert.equal(
        (
            await request(app)
                .get('/api/articles/1')
                .set('Cookie', loggedInCookie)
                .set('X-Forwarded-Proto', 'https')
        ).status,
        401,
    );
});
test('uploaded image is rolled back if the database save fails, and clients receive no internal details', async () => {
    const brokenPool = {
        query(sql, values, callback) {
            if (sql.startsWith('INSERT INTO articles'))
                return Promise.reject(
                    Object.assign(new Error('SECRET SQL DETAILS'), {
                        code: 'XX000',
                    }),
                );
            return pool.query(sql, values, callback);
        },
    };
    const removed = [];
    const app = createApp({
        pool: brokenPool,
        env,
        images: {
            upload: async () => ({
                url: 'https://res.cloudinary.com/demo/image/upload/test.webp',
                publicId: 'rollback-only',
            }),
            remove: async (id) => removed.push(id),
        },
    });
    const client = request.agent(app),
        page = await client.get('/login');
    await client
        .post('/login')
        .type('form')
        .send({
            _csrf: csrfFrom(page.text),
            username: 'security',
            password: 'Strong-test-password-2026!',
        });
    const token = csrfFrom((await client.get('/')).text);
    const png = await sharp({
        create: { width: 2, height: 2, channels: 3, background: '#aabbcc' },
    })
        .png()
        .toBuffer();
    const result = await client
        .post('/articles/add')
        .set('Accept', 'application/json')
        .set('X-CSRF-Token', token)
        .field('title', 'Rollback')
        .field('content', 'Body')
        .field('author', 'Admin')
        .field('category', '1')
        .field('published', 'true')
        .attach('featureImage', png, {
            filename: 'image.png',
            contentType: 'image/png',
        });
    assert.equal(result.status, 500);
    assert.deepEqual(removed, ['rollback-only']);
    assert.ok(!result.text.includes('SECRET'));
});
test('configuration fails closed without a secret or remote certificate verification', () => {
    assert.throws(
        () => createApp({ pool, images: {}, env: {} }),
        /SESSION_SECRET/,
    );
    assert.throws(
        () =>
            createPool({
                DATABASE_URL: 'postgresql://a:b@example.invalid/test',
                DATABASE_SSL: 'false',
            }),
        /require TLS/,
    );
});
test('database outages still render a controlled HTML error page', async () => {
    const broken = createApp({
        pool: {
            query: async () => {
                throw new Error('Database secret details');
            },
        },
        images: {},
        env,
    });
    const response = await request(broken).get('/login');
    assert.equal(response.status, 500);
    assert.ok(!response.text.includes('secret details'));
    assert.match(response.text, /Something went wrong/);
});
