-- A6 randevu module — phase 1 of implementation.
--
-- 1. Extends AppointmentType to the 8 values mandated by the spec
--    (apps PDF "Modül 6 — Randevu tipi enum + renk"). Postgres 16 allows
--    ALTER TYPE ADD VALUE inside a transaction as long as the new label
--    is not used in the same transaction; the constraint below references
--    only existing columns, so this is safe.
--
-- 2. Adds the EXCLUDE GIST constraint that guarantees no two non-cancelled
--    appointments for the same doctor can overlap in time. Combined with
--    a per-doctor pg_advisory_xact_lock in the service create/update path
--    (Hf 4 next PR), this gives DB-level last-line-of-defense against
--    double-booking under concurrent writes.
--
-- The btree_gist extension required by the EXCLUDE constraint was
-- enabled in 20260505190118_init_multitenant.

-- AlterEnum
ALTER TYPE "AppointmentType" ADD VALUE 'examination';
ALTER TYPE "AppointmentType" ADD VALUE 'pre_op';
ALTER TYPE "AppointmentType" ADD VALUE 'post_op';

-- AddConstraint
ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_no_overlap"
  EXCLUDE USING gist (
    "doctor_id" WITH =,
    tsrange("starts_at", "ends_at") WITH &&
  )
  WHERE ("deleted_at" IS NULL AND "status" NOT IN ('cancelled', 'no_show'));
