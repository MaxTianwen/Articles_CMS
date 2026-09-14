const express = require('express');
const path = require('node:path');
const multer = require('multer');
const helmet = require('helmet');
const session = require('express-session');
const PgStore = require('connect-pg-simple')(session);
const { createContentService } = require('./content-service');
const {
    HttpError,
    parseId,
    parseFilters,
    validateArticle,
} = require('./lib/validation');
const { createAuth, csrfToken, checkCsrf } = require('./lib/auth');
const { prepareImage } = require('./lib/images');

function createApp({ pool, images, env = process.env, demo = false }) {
    if (
        !env.SESSION_SECRET ||
        env.SESSION_SECRET.length < 32 ||
        env.SESSION_SECRET.startsWith('replace-')
    )
        throw new Error(
            'Set a random SESSION_SECRET of at least 32 characters.',
        );
    const app = express(),
        service = createContentService(pool),
        auth = createAuth(pool);
    const production = env.NODE_ENV === 'production';
    app.disable('x-powered-by');
    if (env.TRUST_PROXY === '1') app.set('trust proxy', 1);
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views/admin'));
    app.use(
        helmet({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    scriptSrc: ["'self'"],
                    styleSrc: ["'self'", "'unsafe-inline'"],
                    imgSrc: [
                        "'self'",
                        'data:',
                        'blob:',
                        'https://res.cloudinary.com',
                    ],
                    fontSrc: ["'self'", 'data:'],
                    connectSrc: ["'self'"],
                    formAction: ["'self'"],
                    frameAncestors: ["'none'"],
                    upgradeInsecureRequests: production ? [] : null,
                },
            },
            strictTransportSecurity: production ? undefined : false,
        }),
    );
    app.use(
        '/vendor/tabler',
        express.static(path.join(__dirname, 'node_modules/@tabler/core/dist'), {
            maxAge: '1d',
            index: false,
        }),
    );
    app.use(
        express.static(path.join(__dirname, 'public'), {
            maxAge: production ? '1h' : 0,
        }),
    );
    app.use((req, res, next) => {
        Object.assign(res.locals, {
            admin: null,
            csrf: '',
            demo,
            current: req.path,
            error: null,
        });
        res.set('Cache-Control', 'no-store');
        next();
    });
    app.use(
        express.urlencoded({
            extended: false,
            limit: '100kb',
            parameterLimit: 20,
        }),
    );
    app.use(express.json({ limit: '100kb' }));
    const store = new PgStore({
        pool,
        tableName: 'admin_sessions',
        createTableIfMissing: false,
        pruneSessionInterval: false,
        errorLog: () => console.error('Session storage error.'),
    });
    app.use(
        session({
            store,
            name: 'cms.sid',
            secret: env.SESSION_SECRET,
            resave: false,
            saveUninitialized: false,
            rolling: true,
            cookie: {
                httpOnly: true,
                secure: production,
                sameSite: 'lax',
                maxAge: 2 * 60 * 60 * 1000,
            },
        }),
    );
    app.use(async (req, res, next) => {
        res.set('Cache-Control', 'no-store');
        if (
            req.session.adminId &&
            Date.now() - req.session.authenticatedAt > 8 * 60 * 60 * 1000
        ) {
            await new Promise((resolve, reject) =>
                req.session.regenerate((error) =>
                    error ? reject(error) : resolve(),
                ),
            );
        }
        res.locals.admin = req.session.adminId
            ? await auth.currentAdmin(req.session.adminId)
            : null;
        const needsToken = !req.session.csrf;
        res.locals.csrf = csrfToken(req);
        // Fail before rendering a form if its session cannot be persisted.
        if (needsToken)
            await new Promise((resolve, reject) =>
                req.session.save((error) =>
                    error ? reject(error) : resolve(),
                ),
            );
        res.locals.demo = demo;
        res.locals.current = req.path;
        res.locals.error = null;
        res.locals.formatDate = (value) => {
            if (!value) return 'Not recorded';
            // pg DATE values are local calendar dates, not UTC timestamps.
            if (value instanceof Date)
                return [
                    value.getFullYear(),
                    String(value.getMonth() + 1).padStart(2, '0'),
                    String(value.getDate()).padStart(2, '0'),
                ].join('-');
            return String(value).slice(0, 10);
        };
        res.locals.imageUrl = (value) => {
            if (!value) return '';
            if (demo && /^\/demo-images\/[a-z0-9-]+\.webp$/.test(value))
                return value;
            try {
                const url = new URL(value);
                if (url.hostname === 'res.cloudinary.com') {
                    url.protocol = 'https:';
                    return url.href;
                }
            } catch {
                /* Invalid legacy URLs use a placeholder. */
            }
            return '';
        };
        next();
    });
    const wantsJson = (req) =>
        req.path.startsWith('/api/') ||
        ['PUT', 'DELETE'].includes(req.method) ||
        (req.get('Accept') || '').includes('application/json');
    function requireAdmin(req, res, next) {
        if (res.locals.admin) return next();
        if (wantsJson(req))
            return next(new HttpError(401, 'Sign in to continue.'));
        res.redirect('/login');
    }
    app.get('/login', (req, res) =>
        res.locals.admin
            ? res.redirect('/')
            : res.render('login', { title: 'Sign in', username: '' }),
    );
    app.post('/login', checkCsrf, async (req, res) => {
        try {
            const admin = await auth.login(
                req.body.username,
                req.body.password,
                req.ip,
            );
            await pool.query(
                'DELETE FROM admin_sessions WHERE expire < CURRENT_TIMESTAMP',
            );
            await new Promise((resolve, reject) =>
                req.session.regenerate((error) =>
                    error ? reject(error) : resolve(),
                ),
            );
            req.session.adminId = admin.id;
            req.session.authenticatedAt = Date.now();
            await new Promise((resolve, reject) =>
                req.session.save((error) =>
                    error ? reject(error) : resolve(),
                ),
            );
            res.redirect(303, '/');
        } catch (error) {
            if (!error.status) throw error;
            if (error.status === 429) res.set('Retry-After', '900');
            res.status(error.status).render('login', {
                title: 'Sign in',
                error: error.message,
                username:
                    typeof req.body.username === 'string'
                        ? req.body.username
                        : '',
            });
        }
    });
    app.post('/logout', checkCsrf, (req, res, next) =>
        req.session.destroy((error) => {
            if (error) return next(error);
            res.clearCookie('cms.sid', {
                httpOnly: true,
                secure: production,
                sameSite: 'lax',
                path: '/',
            });
            res.redirect(303, '/login');
        }),
    );
    app.use(requireAdmin);
    app.get('/', async (req, res) =>
        res.render('home', {
            title: 'Overview',
            ...(await service.getDashboard()),
        }),
    );
    app.get('/about', (req, res) =>
        res.render('about', { title: 'About this workspace' }),
    );
    app.get('/categories', async (req, res) =>
        res.render('categories', {
            title: 'Categories',
            categories: await service.getCategories(),
        }),
    );
    app.get('/articles/modify', (req, res) => res.redirect('/articles'));
    app.get('/articles', async (req, res) => {
        const filters = parseFilters(req.query),
            result = await service.getArticles(filters);
        const link = (changes) =>
            '/articles?' +
            new URLSearchParams({
                ...filters,
                page: result.page,
                ...changes,
            }).toString();
        res.render('articles', {
            title: 'Articles',
            ...result,
            filters,
            link,
            categories: await service.getCategories(),
        });
    });
    app.get('/articles/add', async (req, res) =>
        res.render('editor', {
            title: 'New article',
            article: {},
            categories: await service.getCategories(),
        }),
    );
    app.get('/articles/:id/edit', async (req, res) =>
        res.render('editor', {
            title: 'Edit article',
            article: await service.getArticle(parseId(req.params.id)),
            categories: await service.getCategories(),
        }),
    );
    app.get('/articles/:id', async (req, res) =>
        res.render('article', {
            title: 'Article preview',
            article: await service.getArticle(parseId(req.params.id)),
        }),
    );
    app.get('/api/articles/:id', async (req, res) =>
        res.json(await service.getArticle(parseId(req.params.id))),
    );
    const upload = multer({
        storage: multer.memoryStorage(),
        limits: {
            fileSize: 4 * 1024 * 1024,
            files: 1,
            fields: 10,
            parts: 11,
            fieldSize: 100000,
        },
    });
    async function cleanImage(publicId) {
        if (!publicId) return;
        try {
            await images.remove(publicId);
        } catch {
            console.error('Image cleanup failed; review Cloudinary assets.');
        }
    }
    async function saveArticle(req, res) {
        const id = req.params.id ? parseId(req.params.id) : null;
        const article = validateArticle(req.body);
        const oldArticle = id ? await service.getArticle(id) : null;
        await service.checkCategory(article.category);
        if (req.file && req.body.removeImage === 'true')
            throw new HttpError(
                400,
                'Choose either a new image or Remove image.',
                { featureImage: 'Conflicting image choices.' },
            );
        let uploaded;
        if (req.file) {
            uploaded = await images.upload(await prepareImage(req.file));
            article.featureImage = uploaded.url;
            article.featureImagePublicId = uploaded.publicId;
        } else if (req.body.removeImage === 'true') {
            article.featureImage = null;
            article.featureImagePublicId = null;
        }
        let saved;
        try {
            saved = id
                ? await service.updateArticle(id, article)
                : await service.addArticle(article);
        } catch (error) {
            await cleanImage(uploaded?.publicId);
            throw error;
        }
        if (
            article.featureImage !== undefined &&
            oldArticle?.featureImagePublicId
        )
            await cleanImage(oldArticle.featureImagePublicId);
        res.status(id ? 200 : 201).json({
            message: 'Article saved.',
            id: saved.id,
            redirect: '/articles/' + saved.id,
        });
    }
    app.post(
        '/articles/add',
        upload.single('featureImage'),
        checkCsrf,
        saveArticle,
    );
    app.put(
        '/articles/:id',
        upload.single('featureImage'),
        checkCsrf,
        saveArticle,
    );
    app.delete('/articles/:id', checkCsrf, async (req, res) => {
        const removed = await service.deleteArticle(parseId(req.params.id));
        await cleanImage(removed.featureImagePublicId);
        res.json({ message: 'Article deleted.', redirect: '/articles' });
    });
    app.use((req, res, next) =>
        next(new HttpError(404, 'This page could not be found.')),
    );
    app.use((error, req, res, next) => {
        if (res.headersSent) {
            console.error('Late response error:', error.code || error.name);
            return res.end();
        }
        let status = error.status || 500,
            message = error.message,
            fields = error.fields || {};
        if (error instanceof multer.MulterError) {
            status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
            message =
                error.code === 'LIMIT_FILE_SIZE'
                    ? 'Choose an image smaller than 4 MB.'
                    : 'The upload contains too many or invalid fields.';
            fields = { featureImage: message };
        }
        if (error.code === '23503') {
            status = 400;
            message = 'The selected category no longer exists.';
            fields = { category: message };
        }
        if (status === 500) {
            console.error('Request failed:', error.code || error.name);
            message = 'Something went wrong. Please try again.';
            req.session = null;
        }
        if (wantsJson(req)) return res.status(status).json({ message, fields });
        res.status(status).render('error', {
            title: 'Unable to continue',
            status,
            message,
        });
    });
    return app;
}
module.exports = { createApp };
