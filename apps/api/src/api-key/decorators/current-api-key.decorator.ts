import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedApiKey } from '../api-key-auth.service';

// External controller handler'larında doğrulanmış ApiKey context'ini almak için.
// request.apiKey ApiKeyGuard tarafından set edilir.

export const CurrentApiKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedApiKey => {
    const req = ctx.switchToHttp().getRequest<{ apiKey?: AuthenticatedApiKey }>();
    if (!req.apiKey) {
      throw new Error('CurrentApiKey used on a route without ApiKeyGuard');
    }
    return req.apiKey;
  },
);
