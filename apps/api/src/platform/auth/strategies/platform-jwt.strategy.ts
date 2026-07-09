import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { PlatformJwtPayload } from '../platform-auth.types';

/**
 * Separate Passport strategy ('platform-jwt') from the tenant 'jwt' strategy.
 * Different secret = a tenant-issued token cannot pass for a platform JWT and
 * vice-versa, even if both share the bearer header transport.
 */
@Injectable()
export class PlatformJwtStrategy extends PassportStrategy(Strategy, 'platform-jwt') {
  constructor(config: ConfigService) {
    const secret = config.get<string>('PLATFORM_JWT_ACCESS_SECRET');
    if (!secret) throw new Error('PLATFORM_JWT_ACCESS_SECRET is not set');

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  validate(payload: PlatformJwtPayload): PlatformJwtPayload {
    if (!payload.sub || !payload.email || !payload.role) {
      throw new UnauthorizedException('Invalid platform token payload');
    }
    return payload;
  }
}
