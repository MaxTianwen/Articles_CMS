const {
    randomBytes,
    scrypt: scryptCallback,
    timingSafeEqual,
    createHash,
} = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(scryptCallback);
const { HttpError } = require('./validation');
const passwordOptions = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

async function hashPassword(password) {
    if (
        typeof password !== 'string' ||
        password.length < 15 ||
        password.length > 128
    )
        throw new Error('Use a password of 15–128 characters.');
    const salt = randomBytes(16).toString('hex');
    const key = await scrypt(password, salt, 64, passwordOptions);
    return 'scrypt$' + salt + '$' + key.toString('hex');
}
async function verifyPassword(password, hash) {
    const parts = typeof hash === 'string' ? hash.split('$') : [];
    const validHash =
        parts.length === 3 &&
        parts[0] === 'scrypt' &&
        /^[a-f0-9]{32}$/.test(parts[1]) &&
        /^[a-f0-9]{128}$/.test(parts[2]);
    const candidate = await scrypt(
        password,
        validHash ? parts[1] : '00000000000000000000000000000000',
        64,
        passwordOptions,
    );
    return (
        validHash && timingSafeEqual(candidate, Buffer.from(parts[2], 'hex'))
    );
}
function csrfToken(req) {
    if (!req.session.csrf) req.session.csrf = randomBytes(32).toString('hex');
    return req.session.csrf;
}
function checkCsrf(req, res, next) {
    const token = req.get('X-CSRF-Token') || req.body?._csrf;
    const expected = req.session.csrf;
    if (
        typeof token !== 'string' ||
        !/^[a-f0-9]{64}$/.test(token) ||
        !expected ||
        !timingSafeEqual(Buffer.from(token), Buffer.from(expected))
    )
        return next(
            new HttpError(
                403,
                'Your security token has expired. Reload the page and try again.',
            ),
        );
    next();
}
function createAuth(pool) {
    async function currentAdmin(id) {
        const result = await pool.query(
            'SELECT id, username FROM admins WHERE id=$1 AND active=true',
            [id],
        );
        return result.rows[0];
    }
    async function limitLogin(ip, username) {
        // Shared counters work across server instances. Expired rows are removed on login.
        await pool.query(
            'DELETE FROM login_attempts WHERE reset_at < CURRENT_TIMESTAMP',
        );
        for (const [scope, value, limit] of [
            ['ip', ip, 20],
            ['username', username, 10],
        ]) {
            const key =
                scope + ':' + createHash('sha256').update(value).digest('hex');
            const result = await pool.query(
                "INSERT INTO login_attempts (key, attempts, reset_at) VALUES ($1,1,CURRENT_TIMESTAMP + INTERVAL '15 minutes') ON CONFLICT (key) DO UPDATE SET attempts=login_attempts.attempts+1 RETURNING attempts",
                [key],
            );
            if (result.rows[0].attempts > limit)
                throw new HttpError(
                    429,
                    'Too many sign-in attempts. Please try again in 15 minutes.',
                );
        }
    }
    async function login(username, password, ip) {
        if (
            typeof username !== 'string' ||
            typeof password !== 'string' ||
            username.length > 64 ||
            password.length > 128
        )
            throw new HttpError(400, 'Enter a valid username and password.');
        const normalized = username.trim().toLowerCase();
        await limitLogin(ip, normalized);
        const result = await pool.query(
            'SELECT id, username, password_hash FROM admins WHERE username=$1 AND active=true',
            [normalized],
        );
        const admin = result.rows[0];
        if (!(await verifyPassword(password, admin?.password_hash)))
            throw new HttpError(401, 'The username or password is incorrect.');
        return { id: admin.id, username: admin.username };
    }
    return { currentAdmin, login };
}
module.exports = {
    hashPassword,
    verifyPassword,
    csrfToken,
    checkCsrf,
    createAuth,
};
