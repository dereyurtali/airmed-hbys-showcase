import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { PlatformJwtPayload } from '../platform-auth.types';

export const CurrentPlatformAdmin = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): PlatformJwtPayload => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: PlatformJwtPayload }>();
    if (!req.user) throw new Error('CurrentPlatformAdmin used without PlatformJwtAuthGuard');
    return req.user;
  },
);
