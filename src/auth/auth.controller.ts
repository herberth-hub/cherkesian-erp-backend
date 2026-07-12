import { Body, Controller, HttpCode, HttpStatus, Ip, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { AuthorizeOffhoursDto } from './dto/authorize-offhours.dto';
import { Public } from '../common/decorators/public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Anti brute-force: no máximo 8 tentativas de login por minuto por IP.
  @Throttle({ default: { limit: 8, ttl: 60000 } })
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Throttle({ default: { limit: 8, ttl: 60000 } })
  @Public()
  @Post('authorize-offhours')
  @HttpCode(HttpStatus.OK)
  authorizeOffhours(@Body() dto: AuthorizeOffhoursDto, @Ip() ip: string) {
    return this.authService.authorizeOffhours(dto, ip);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }
}
