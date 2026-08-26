-- Extensions the schema depends on.
--   pgcrypto   -> gen_random_uuid(), digest() for PII hashing
--   btree_gist -> EXCLUDE USING gist (uuid WITH =, range WITH &&) on tier prices / rate cards
--   pg_trgm    -> trigram index for typo-tolerant model search (Phase 2)
--   unaccent   -> normalisation in the SKU key function
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Test database used by Jest integration runs that need a dedicated DB.
SELECT 'CREATE DATABASE trugrade_test OWNER trugrade'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'trugrade_test')\gexec
