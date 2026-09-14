class HttpError extends Error {
    constructor(status, message, fields = {}) {
        super(message);
        this.status = status;
        this.fields = fields;
    }
}
function parseId(value, name = 'Article ID') {
    if (
        typeof value !== 'string' ||
        !/^[1-9]\d*$/.test(value) ||
        Number(value) > 2147483647
    )
        throw new HttpError(400, name + ' must be a positive integer.');
    return Number(value);
}
function validateArticle(body) {
    const fields = {},
        article = {};
    for (const [key, max] of Object.entries({
        title: 200,
        content: 50000,
        author: 100,
    })) {
        if (
            typeof body[key] !== 'string' ||
            !body[key].trim() ||
            body[key].length > max
        )
            fields[key] = `Enter ${key} (1–${max} characters).`;
        else article[key] = body[key].trim();
    }
    try {
        article.category = parseId(body.category, 'Category');
    } catch {
        fields.category = 'Choose a valid category.';
    }
    if (!['true', 'false'].includes(body.published))
        fields.published = 'Choose Published or Unpublished.';
    article.published = body.published === 'true';
    if (
        body.removeImage !== undefined &&
        !['true', 'false'].includes(body.removeImage)
    )
        fields.featureImage = 'Invalid image operation.';
    if (Object.keys(fields).length)
        throw new HttpError(400, 'Check the highlighted fields.', fields);
    return article;
}
function parseFilters(query) {
    const filters = {
        search: '',
        category: '',
        status: '',
        minDate: '',
        sort: 'newest',
        page: 1,
        view: 'table',
    };
    for (const key of Object.keys(filters))
        if (query[key] !== undefined && typeof query[key] !== 'string')
            throw new HttpError(400, 'Invalid filter: ' + key);
    if (query.search) {
        if (query.search.length > 200)
            throw new HttpError(400, 'Search is too long.');
        filters.search = query.search.trim();
    }
    if (query.category) filters.category = parseId(query.category, 'Category');
    if (query.page) filters.page = parseId(query.page, 'Page');
    if (query.status) {
        if (!['published', 'draft'].includes(query.status))
            throw new HttpError(400, 'Invalid status.');
        filters.status = query.status;
    }
    if (query.minDate) {
        const date = new Date(query.minDate);
        if (
            !/^\d{4}-\d{2}-\d{2}$/.test(query.minDate) ||
            !Number.isFinite(date.getTime()) ||
            date.toISOString().slice(0, 10) !== query.minDate
        )
            throw new HttpError(400, 'Enter a valid date.');
        filters.minDate = query.minDate;
    }
    if (query.sort) {
        if (!['newest', 'oldest', 'title'].includes(query.sort))
            throw new HttpError(400, 'Invalid sort order.');
        filters.sort = query.sort;
    }
    if (query.view) {
        if (!['table', 'gallery'].includes(query.view))
            throw new HttpError(400, 'Invalid article view.');
        filters.view = query.view;
    }
    return filters;
}
module.exports = { HttpError, parseId, validateArticle, parseFilters };
