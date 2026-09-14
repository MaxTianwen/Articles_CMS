const fs = require('node:fs/promises');
const path = require('node:path');
async function main() {
    const destination = path.join(__dirname, '../public/vendor/tabler/css');
    await fs.mkdir(destination, { recursive: true });
    const root = path.dirname(require.resolve('@tabler/core/package.json'));
    for (const name of ['tabler.min.css', 'tabler.min.css.map'])
        await fs.copyFile(
            path.join(root, 'dist/css', name),
            path.join(destination, name),
        );
    await fs.copyFile(
        path.join(__dirname, '../THIRD_PARTY_NOTICES.md'),
        path.join(destination, '../LICENSE'),
    );
    console.log('Tabler styles and license prepared for static hosting.');
}
main().catch((error) => {
    console.error('Asset build failed:', error.message);
    process.exitCode = 1;
});
