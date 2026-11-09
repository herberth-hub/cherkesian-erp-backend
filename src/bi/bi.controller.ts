import { Controller, Get } from '@nestjs/common';
import { BiService } from './bi.service';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

@Areas('bi')
@Controller('bi')
export class BiController {
  constructor(private readonly bi: BiService) {}

  /** Dentro do BI, quem não tem visão financeira recebe o mesmo painel sem as
   *  duas séries de faturamento (por CNPJ e mês a mês) — a leitura de
   *  produtividade fica inteira, o retrato financeiro não. É o caso da
   *  consultoria externa, que precisa do BI e não vê o dinheiro da casa. */
  @Get('producao')
  producao(@CurrentUser() user: AuthUser) {
    return this.bi.producao(user.empresaId, user.acesso);
  }
}
