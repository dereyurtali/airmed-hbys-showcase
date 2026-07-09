import {
  Body,
  Controller,
  Get,
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
import { AuthService } from './auth.service';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './cookie.util';
import { BlockImpersonation } from './decorators/block-impersonation.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { JwtPayload } from './auth.types';

const TEST_BYPASS = process.env.NODE_ENV === 'test';
const tightLimit = (limit: number) => (TEST_BYPASS ? 10_000 : limit);

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  // A13: 5/min per IP (kanonik auth tablosu) — kullanıcı-seviyesi 5 fail / 15 dk
  // kilidi ile birlikte brute-force defansını sıkılaştırır. Test'te bypass.
  @Throttle({ default: { ttl: 60_000, limit: tightLimit(5) } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(
      dto.tenantSlug,
      dto.email,
      dto.password,
      req.ip,
      req.get('user-agent'),
      dto.mode,
    );
    // v0.4 (#539) — iki fazlı giriş: mod seçimi gerekiyorsa token/cookie yok,
    // uygun modlar döner; istemci modu seçip tekrar login eder.
    if ('needsModeSelection' in result) {
      return { needsModeSelection: true as const, availableModes: result.availableModes };
    }
    setRefreshCookie(res, result.refreshToken);
    return {
      accessToken: result.accessToken,
      mustChangePassword: result.mustChangePassword,
    };
  }

  @Public()
  // Refresh is called on every page load and on token expiry; allow more.
  @Throttle({ default: { ttl: 60_000, limit: tightLimit(30) } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = readRefreshCookie(req);
    if (!token) throw new UnauthorizedException('Missing refresh token');
    const tokens = await this.auth.refresh(token, req.ip, req.get('user-agent'));
    setRefreshCookie(res, tokens.refreshToken);
    return { accessToken: tokens.accessToken };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(readRefreshCookie(req));
    clearRefreshCookie(res);
  }

  // F4 — `/api/auth/me` mevcut oturum bilgisini + (varsa) impersonation
  // context'ini döndürür. Frontend banner için: `impersonation` alanı dolu
  // ise tenant UI'da sticky kırmızı banner mount eder.
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return {
      id: user.sub,
      tenantId: user.tenantId,
      email: user.email,
      roles: user.roles,
      impersonation: user.imp
        ? {
            by: user.imp.by,
            byName: user.imp.byName,
            impersonationId: user.imp.id,
          }
        : null,
    };
  }

  // F7 — Tenant UI banner'ındaki "Stop" butonu. Sadece impersonation token
  // ile çağrılabilir (imp claim zorunlu); impersonation row'unu kapatır ve
  // logout işler. Platform admin'in active listesinden anında düşer.
  @UseGuards(JwtAuthGuard)
  @Post('stop-impersonation')
  @HttpCode(HttpStatus.NO_CONTENT)
  async stopImpersonation(
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.stopImpersonation(user);
    clearRefreshCookie(res);
  }

  @UseGuards(JwtAuthGuard)
  @BlockImpersonation()
  @Throttle({ default: { ttl: 60_000, limit: tightLimit(10) } })
  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.changePassword(user.sub, dto.currentPassword, dto.newPassword);
    clearRefreshCookie(res);
  }
}
