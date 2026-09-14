const { createApp } = require('./app');
const { createPool } = require('./lib/database');
const { createImageService } = require('./lib/images');
let app;
function getApp() {
    if (!app)
        app = createApp({
            pool: createPool(),
            images: createImageService(),
            env: process.env,
        });
    return app;
}
// Importing the app does not start a listener or run migrations.
module.exports = (req, res) => getApp()(req, res);
if (require.main === module) {
    try {
        const server = getApp().listen(Number(process.env.PORT) || 3838, () =>
            console.log(
                'CMS listening at http://localhost:' + server.address().port,
            ),
        );
    } catch (error) {
        console.error('Startup failed:', error.message);
        process.exitCode = 1;
    }
}
