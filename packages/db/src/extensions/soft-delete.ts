import { Prisma } from '@prisma/client';

/**
 * Soft-delete extension for Prisma 5.
 *
 * - `delete` / `deleteMany` → set `deletedAt = now()` instead of removing rows.
 * - `findMany` / `findFirst` / `count` → auto-filter `deletedAt: null`.
 * - To include soft-deleted rows, pass `withDeleted: true` in the args.
 *
 * Models with soft-delete: User, Patient, Doctor, Appointment, Examination,
 * Surgery, Measurement.
 *
 * Models WITHOUT soft-delete (immutable / managed differently):
 * AuditLog, Tenant (suspendedAt), RefreshToken (revokedAt), PlatformAdmin,
 * Role, UserRole, DoctorAvailability.
 */
const SOFT_DELETE_MODELS = new Set([
  'User',
  'Patient',
  'Doctor',
  'Appointment',
  'Examination',
  'Surgery',
  'Measurement',
]);

function applyDeletedAtFilter(args: any) {
  // Bail when caller explicitly opts in to seeing soft-deleted rows.
  if (args?.withDeleted === true) {
    delete args.withDeleted;
    return args;
  }
  args = args ?? {};
  args.where = args.where ?? {};
  if (args.where.deletedAt === undefined) {
    args.where.deletedAt = null;
  }
  return args;
}

function modelDelegate(client: any, model: string): any {
  const key = model.charAt(0).toLowerCase() + model.slice(1);
  return client[key];
}

export const softDeleteExtension = Prisma.defineExtension((client) =>
  client.$extends({
    name: 'softDelete',
    query: {
      $allModels: {
        async findMany({ model, args, query }) {
          if (SOFT_DELETE_MODELS.has(model)) {
            args = applyDeletedAtFilter(args);
          }
          return query(args);
        },
        async findFirst({ model, args, query }) {
          if (SOFT_DELETE_MODELS.has(model)) {
            args = applyDeletedAtFilter(args);
          }
          return query(args);
        },
        async count({ model, args, query }) {
          if (SOFT_DELETE_MODELS.has(model)) {
            args = applyDeletedAtFilter(args);
          }
          return query(args);
        },
        async delete({ model, args, query }) {
          if (SOFT_DELETE_MODELS.has(model)) {
            // Convert delete → update set deletedAt = now() via the underlying client.
            return modelDelegate(client, model).update({
              where: (args as any).where,
              data: { deletedAt: new Date() },
            });
          }
          return query(args);
        },
        async deleteMany({ model, args, query }) {
          if (SOFT_DELETE_MODELS.has(model)) {
            return modelDelegate(client, model).updateMany({
              where: { ...(args as any)?.where, deletedAt: null },
              data: { deletedAt: new Date() },
            });
          }
          return query(args);
        },
      },
    },
  }),
);
