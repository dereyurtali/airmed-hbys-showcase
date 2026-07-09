import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../../auth/decorators/public.decorator';
import { PlatformRoute } from '../../common/decorators/platform-route.decorator';
import {
  clearPlatformRefreshCookie,
  readPlatformRefreshCookie,
  setPlatformRefreshCookie,
} from './cookie.util';
import { CurrentPlatformAdmin } from './decorators/current-platform-admin.decorator';
import { PlatformLoginDto } from './dto/platform-login.dto';
import { PlatformVerifyTotpDto } from './dto/platform-verify-totp.dto';
import { PlatformJwtAuthGuard } from './guards/platform-jwt-auth.guard';
import { PlatformAuthService } from './platform-auth.service';
import type { PlatformJwtPayload } from './platform-auth.types';

const TEST_BYPASS = process.env.NODE_ENV === 'test';
const tightLimit = (limit: number) => (TEST_BYPASS ? 10_000 : limit);

@PlatformRoute()
@Controller('platform/auth')
export class PlatformAuthController {
  constructor(private readonly auth: PlatformAuthService) {}

  @Public()
  @Throttle({ default: { ttl: 15 * 60_000, limit: tightLimit(3) } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: PlatformLoginDto, @Req() req: Request) {
    return this.auth.login(dto.email, dto.password, {
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
  }

  @Public()
  @Throttle({ default: { ttl: 15 * 60_000, limit: tightLimit(5) } })
  @Post('setup-totp')
  @HttpCode(HttpStatus.OK)
  async setupTotp(@Headers('authorization') authHeader: string | undefined, @Req() req: Request) {
    const challenge = extractBearer(authHeader);
    return this.auth.setupTotp(challenge, {
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
  }

  @Public()
  @Throttle({ default: { ttl: 15 * 60_000, limit: tightLimit(10) } })
  @Post('verify-totp')
  @HttpCode(HttpStatus.OK)
  async verifyTotp(
    @Headers('authorization') authHeader: string | undefined,
    @Body() dto: PlatformVerifyTotpDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const challenge = extractBearer(authHeader);
    const tokens = await this.auth.verifyTotp(challenge, dto, {
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    setPlatformRefreshCookie(res, tokens.refreshToken);
    return { accessToken: tokens.accessToken };
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: tightLimit(30) } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = readPlatformRefreshCookie(req);
    if (!token) throw new UnauthorizedException('Missing refresh token');
    const tokens = await this.auth.refresh(token, {
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    setPlatformRefreshCookie(res, tokens.refreshToken);
    return { accessToken: tokens.accessToken };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(readPlatformRefreshCookie(req));
    clearPlatformRefreshCookie(res);
  }

  @UseGuards(PlatformJwtAuthGuard)
  @Get('me')
  me(@CurrentPlatformAdmin() admin: PlatformJwtPayload) {
    return { id: admin.sub, email: admin.email, role: admin.role };
  }
}

function extractBearer(header: string | undefined): string {
  if (!header) throw new UnauthorizedException('Missing challenge token');
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw new UnauthorizedException('Malformed challenge header');
  }
  return token;
}
