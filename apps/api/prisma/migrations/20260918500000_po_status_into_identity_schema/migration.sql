-- Put po_status where the schema says it lives.
--
-- 20260902000000_phase6_orders ran `CREATE TYPE po_status` without a schema, so
-- the type landed in whatever came first on the connection's search_path. On a
-- database created through the migration harness that was `identity`; on the
-- live database it was `public`. Prisma maps the enum to identity.po_status, so
-- on live every query casting to it failed, and 20260919000000_po_line_response
-- (ALTER TYPE identity.po_status) could not apply.
--
-- Columns and indexes reference a type by OID, not by name, so moving the schema
-- changes nothing that uses it. A no-op wherever the type is already in identity.

DO $$
BEGIN
  IF to_regtype('identity.po_status') IS NULL AND to_regtype('public.po_status') IS NOT NULL THEN
    ALTER TYPE public.po_status SET SCHEMA identity;
  END IF;
END $$;
