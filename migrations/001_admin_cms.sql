BEGIN;
CREATE TABLE IF NOT EXISTS categories (id integer PRIMARY KEY, "Name" varchar(100) NOT NULL);
CREATE TABLE IF NOT EXISTS articles (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title varchar(200), content text, author varchar(100), published boolean DEFAULT false,
    category integer, "articleDate" date DEFAULT CURRENT_DATE, "featureImage" text
);
ALTER TABLE articles ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE articles ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS "featureImagePublicId" text;
-- Legacy dates are preserved; NULL updated_at means no known edit timestamp.
-- NOT VALID enforces new writes without silently changing legacy records.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='articles_category_fk' AND conrelid='articles'::regclass) THEN
        ALTER TABLE articles ADD CONSTRAINT articles_category_fk FOREIGN KEY (category) REFERENCES categories(id) ON DELETE RESTRICT NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='articles_required_fields' AND conrelid='articles'::regclass) THEN
        ALTER TABLE articles ADD CONSTRAINT articles_required_fields CHECK (
            title IS NOT NULL AND length(trim(title)) BETWEEN 1 AND 200 AND
            author IS NOT NULL AND length(trim(author)) BETWEEN 1 AND 100 AND
            content IS NOT NULL AND length(trim(content)) BETWEEN 1 AND 50000 AND
            category IS NOT NULL AND published IS NOT NULL
        ) NOT VALID;
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS articles_category_idx ON articles(category);
CREATE INDEX IF NOT EXISTS articles_date_idx ON articles("articleDate" DESC, id DESC);
CREATE TABLE IF NOT EXISTS admins (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username varchar(64) UNIQUE NOT NULL,
    password_hash text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS admin_sessions (sid varchar PRIMARY KEY, sess json NOT NULL, expire timestamp NOT NULL);
CREATE INDEX IF NOT EXISTS admin_sessions_expire_idx ON admin_sessions(expire);
CREATE TABLE IF NOT EXISTS login_attempts (key varchar(80) PRIMARY KEY, attempts integer NOT NULL, reset_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS login_attempts_expiry_idx ON login_attempts(reset_at);
COMMIT;
