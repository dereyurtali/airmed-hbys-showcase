import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { ClsServiceManager } from 'nestjs-cls';

export const CurrentTenant = createParamDecorator(
  (_data: unknown, _ctx: ExecutionContext): string => {
    const cls = ClsServiceManager.getClsService();
    const tenantId = cls.get<string | undefined>('tenantId');
    if (!tenantId) throw new Error('Tenant context not set');
    return tenantId;
  },
);
