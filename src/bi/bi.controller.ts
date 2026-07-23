import { Controller, Get } from '@nestjs/common';
import { BiService } from './bi.service';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

@Areas('dashboard')
@Controller('bi')
export class BiController {
  constructor(private readonly bi: BiService) {}

  @Get('producao')
  producao(@CurrentUser() user: AuthUser) {
    return this.bi.producao(user.empresaId);
  }
}
