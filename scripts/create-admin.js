const readline = require('node:readline/promises');
const { createPool } = require('../lib/database');
const { hashPassword } = require('../lib/auth');
async function main() {
    const input = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    const username = (await input.question('Administrator username: '))
        .trim()
        .toLowerCase();
    input.close();
    if (!/^[a-z0-9._-]{3,64}$/.test(username))
        throw new Error(
            'Username must be 3–64 letters, numbers, dots, underscores or hyphens.',
        );
    if (!process.stdin.isTTY)
        throw new Error(
            'Use an interactive terminal to enter the password securely.',
        );
    process.stdout.write('Password (15–128 characters; hidden): ');
    require('node:readline').emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const password = await new Promise((resolve, reject) => {
        let value = '';
        function finish(error) {
            process.stdin.off('keypress', onKey);
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdout.write('\n');
            error ? reject(error) : resolve(value);
        }
        function onKey(text, key) {
            if (key?.ctrl && key.name === 'c')
                return finish(new Error('Cancelled.'));
            if (key?.name === 'return') return finish();
            if (key?.name === 'backspace') value = value.slice(0, -1);
            else if (text && !key?.ctrl && !key?.meta) value += text;
        }
        process.stdin.on('keypress', onKey);
    });
    const hash = await hashPassword(password),
        pool = createPool();
    try {
        await pool.query(
            'INSERT INTO admins (username,password_hash) VALUES ($1,$2)',
            [username, hash],
        );
        console.log('Administrator created.');
    } finally {
        await pool.end();
    }
}
main().catch((error) => {
    console.error(
        error.code === '23505'
            ? 'That username already exists; no account was changed.'
            : error.code
              ? 'Administrator creation failed. Check database configuration.'
              : error.message,
    );
    process.exitCode = 1;
});
