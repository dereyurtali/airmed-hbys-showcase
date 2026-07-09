import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Use on platform-protected handlers, e.g.
 *   @UseGuards(PlatformJwtAuthGuard)
 *   @PlatformRoles('platform_owner')
 *   @Get('tenants') ...
 *
 * The global `JwtAuthGuard` is bypassed because every /platform/auth/* and
 * downstream handler should be reached only via this guard (or @Public()).
 */
@Injectable()
export class PlatformJwtAuthGuard extends AuthGuard('platform-jwt') {}
