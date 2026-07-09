import { Module } from '@nestjs/common';
import { ApiKeyAuthService } from './api-key-auth.service';
import { ApiKeyGuard } from './api-key.guard';
import { ApiKeyService } from './api-key.service';
import { ScopesGuard } from './scopes.guard';

@Module({
  providers: [ApiKeyService, ApiKeyAuthService, ApiKeyGuard, ScopesGuard],
  exports: [ApiKeyService, ApiKeyAuthService, ApiKeyGuard, ScopesGuard],
})
export class ApiKeyModule {}
