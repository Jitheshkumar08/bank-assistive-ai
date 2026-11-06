-- Audit history is append-only: rows can be inserted but never updated or deleted, even by application bugs.
-- (Administrators with schema rights can still drop the trigger deliberately; that change would be visible in migrations.)
CREATE OR REPLACE FUNCTION "campusguide_audit_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent rows are append-only';
END;
$$;

CREATE TRIGGER "AuditEvent_append_only"
BEFORE UPDATE OR DELETE ON "AuditEvent"
FOR EACH ROW EXECUTE FUNCTION "campusguide_audit_append_only"();
