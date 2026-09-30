import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';

import { AuthService } from './auth.service';
import { AuthGuard, AuthUser } from './auth.guard';
import { CurrentUser } from './context.decorator';
import {
  ForgotPasswordDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  ResetPasswordDto,
} from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @Throttle({ default: { ttl: 3_600_000, limit: 10 } })
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.auth.register(dto, {
      ip: req.ip,
      ua: req.headers['user-agent'],
    });
  }

  /** 10 tentatives par minute et par IP : freine le bourrage d'identifiants. */
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, {
      ip: req.ip,
      ua: req.headers['user-agent'],
    });
  }

  /** 5 demandes par heure et par IP : évite d'inonder une boîte mail. */
  @Post('forgot-password')
  @HttpCode(200)
  @Throttle({ default: { ttl: 3_600_000, limit: 5 } })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.requestPasswordReset(dto.email);
  }

  @Post('reset-password')
  @HttpCode(200)
  @Throttle({ default: { ttl: 3_600_000, limit: 10 } })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  logout(@CurrentUser() user: AuthUser) {
    return this.auth.logout(user.sessionId);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  /** Organisations de l'utilisateur — sert au routage du dashboard. */
  @Get('me/organizations')
  @UseGuards(AuthGuard)
  organizations(@CurrentUser() user: AuthUser) {
    return this.auth.listMemberships(user.id);
  }
}
