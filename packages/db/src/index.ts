export { PrismaClient } from '@prisma/client';
export type * from '@prisma/client';

export { softDeleteExtension } from './extensions/soft-delete';
export { DEFAULT_CLINIC_ROLES, ensureClinicRoles, type SeedRoleConfig } from './seed-helpers';
