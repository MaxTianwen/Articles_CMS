const { Pool } = require('pg');
function createPool(env = process.env) {
    if (!env.DATABASE_URL)
        throw new Error('DATABASE_URL is required. See .env.example.');
    const url = new URL(env.DATABASE_URL);
    for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert'])
        url.searchParams.delete(key);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (!local && env.DATABASE_SSL === 'false')
        throw new Error('Remote databases require TLS.');
    const pool = new Pool({
        connectionString: url.toString(),
        ssl:
            local && env.DATABASE_SSL === 'false'
                ? false
                : { rejectUnauthorized: true },
        max: 5,
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 10000,
    });
    pool.on('error', (error) =>
        console.error('Database connection error:', error.code || 'unknown'),
    );
    return pool;
}
module.exports = { createPool };
