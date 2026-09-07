-- AUTO-GENERATED FILE. DO NOT EDIT MANUALLY.
-- schema: public
-- generated_at: 2025-12-24T07:26:12.074Z

BEGIN;
-- Drop triggers first to make re-apply idempotent
DROP TRIGGER IF EXISTS "update_operator_accounts_updated_at" ON "public"."operator_accounts";

-- Recreate triggers
-- trigger: public.operator_accounts :: update_operator_accounts_updated_at
CREATE TRIGGER update_operator_accounts_updated_at BEFORE UPDATE ON operator_accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
