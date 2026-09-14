-- Historical coursework schema. Current setup/upgrade: npm run db:migrate.
-- See migrations/001_admin_cms.sql for the active administrator CMS schema.
-- Table: public.articles

-- DROP TABLE IF EXISTS public.articles;

CREATE TABLE IF NOT EXISTS public.articles
(
    id integer NOT NULL GENERATED ALWAYS AS IDENTITY ( INCREMENT 1 START 6 MINVALUE 1 MAXVALUE 2147483647 CACHE 1 ),
    title character varying COLLATE pg_catalog."default",
    content character varying COLLATE pg_catalog."default",
    author character varying COLLATE pg_catalog."default",
    published boolean,
    category integer,
    "articleDate" date,
    "featureImage" character varying COLLATE pg_catalog."default",
    CONSTRAINT articles_pkey PRIMARY KEY (id)
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.articles
    OWNER to "SenecaDB_owner";


-- Table: public.categories

-- DROP TABLE IF EXISTS public.categories;

CREATE TABLE IF NOT EXISTS public.categories
(
    id integer NOT NULL,
    "Name" character varying COLLATE pg_catalog."default",
    CONSTRAINT categories_pkey PRIMARY KEY (id)
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.categories
    OWNER to "SenecaDB_owner";

