// SQL stays here; routes select HTTP responses and EJS selects presentation.
const { HttpError } = require('./lib/validation');

function createContentService(pool) {
    const columns =
        'a.*, a."articleDate"::text AS "articleDate", c."Name" AS "categoryName"';
    const joined = 'articles a LEFT JOIN categories c ON c.id = a.category';
    async function getCategories() {
        const result = await pool.query(
            'SELECT c.*, COUNT(a.id)::int AS "articleCount" FROM categories c LEFT JOIN articles a ON a.category = c.id GROUP BY c.id, c."Name" ORDER BY c."Name"',
        );
        return result.rows;
    }
    async function getArticles(filters = {}) {
        const values = [],
            conditions = [];
        function add(sql, value) {
            values.push(value);
            conditions.push(sql.replace('?', '$' + values.length));
        }
        if (filters.search)
            add(
                'a.title ILIKE ?',
                '%' + filters.search.replace(/[\\%_]/g, '\\$&') + '%',
            );
        if (filters.category) add('a.category = ?', filters.category);
        if (filters.status === 'published')
            conditions.push('a.published = true');
        if (filters.status === 'draft')
            conditions.push('a.published IS NOT TRUE');
        if (filters.minDate) add('a."articleDate" >= ?', filters.minDate);
        const where = conditions.length
            ? ' WHERE ' + conditions.join(' AND ')
            : '';
        const count = await pool.query(
            'SELECT COUNT(*)::int AS total FROM articles a' + where,
            values,
        );
        const total = count.rows[0].total,
            pages = Math.max(1, Math.ceil(total / 10));
        const page = Math.min(filters.page || 1, pages);
        const order = {
            newest: 'a."articleDate" DESC NULLS LAST, a.id DESC',
            oldest: 'a."articleDate" ASC NULLS LAST, a.id ASC',
            title: 'a.title ASC, a.id ASC',
        }[filters.sort || 'newest'];
        const result = await pool.query(
            `SELECT ${columns} FROM ${joined}${where} ORDER BY ${order} LIMIT 10 OFFSET $${values.length + 1}`,
            [...values, (page - 1) * 10],
        );
        return { articles: result.rows, total, page, pages };
    }
    async function getArticle(id) {
        const result = await pool.query(
            `SELECT ${columns} FROM ${joined} WHERE a.id = $1`,
            [id],
        );
        if (!result.rows.length) throw new HttpError(404, 'Article not found.');
        return result.rows[0];
    }
    async function checkCategory(category) {
        const result = await pool.query(
            'SELECT id FROM categories WHERE id = $1',
            [category],
        );
        if (!result.rows.length)
            throw new HttpError(400, 'Choose an existing category.', {
                category: 'This category no longer exists.',
            });
    }
    async function addArticle(article) {
        await checkCategory(article.category);
        const result = await pool.query(
            'INSERT INTO articles (title, content, author, category, published, "articleDate", "featureImage", "featureImagePublicId") VALUES ($1,$2,$3,$4,$5,CURRENT_DATE,$6,$7) RETURNING *',
            [
                article.title,
                article.content,
                article.author,
                article.category,
                article.published,
                article.featureImage || null,
                article.featureImagePublicId || null,
            ],
        );
        return result.rows[0];
    }
    async function updateArticle(id, article) {
        await checkCategory(article.category);
        // Missing image means preserve the DB value, not trust a hidden URL.
        const replaceImage = article.featureImage !== undefined;
        const result = await pool.query(
            'UPDATE articles SET title=$1, content=$2, author=$3, category=$4, published=$5, "featureImage"=CASE WHEN $6 THEN $7 ELSE "featureImage" END, "featureImagePublicId"=CASE WHEN $6 THEN $8 ELSE "featureImagePublicId" END, updated_at=CURRENT_TIMESTAMP WHERE id=$9 RETURNING *',
            [
                article.title,
                article.content,
                article.author,
                article.category,
                article.published,
                replaceImage,
                article.featureImage ?? null,
                article.featureImagePublicId ?? null,
                id,
            ],
        );
        if (!result.rows.length) throw new HttpError(404, 'Article not found.');
        return result.rows[0];
    }
    async function deleteArticle(id) {
        const result = await pool.query(
            'DELETE FROM articles WHERE id=$1 RETURNING *',
            [id],
        );
        if (!result.rows.length) throw new HttpError(404, 'Article not found.');
        return result.rows[0];
    }
    async function getDashboard() {
        const counts = await pool.query(
            'SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE published=true)::int AS published, COUNT(*) FILTER (WHERE published IS NOT TRUE)::int AS drafts FROM articles',
        );
        const recent = await pool.query(
            `SELECT ${columns} FROM ${joined} ORDER BY a.updated_at DESC NULLS LAST, a.id DESC LIMIT 5`,
        );
        const drafts = await pool.query(
            `SELECT ${columns} FROM ${joined} WHERE a.published IS NOT TRUE ORDER BY a.updated_at DESC NULLS LAST, a.id DESC LIMIT 3`,
        );
        return {
            counts: counts.rows[0],
            recent: recent.rows,
            drafts: drafts.rows,
            categories: await getCategories(),
        };
    }
    return {
        getCategories,
        getArticles,
        getArticle,
        checkCategory,
        addArticle,
        updateArticle,
        deleteArticle,
        getDashboard,
    };
}
module.exports = { createContentService };
