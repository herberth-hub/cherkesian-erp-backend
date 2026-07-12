import { Controller, Get, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { RelatoriosService } from './relatorios.service';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

// Gate amplo (perfis de escritório); o RBAC fino é POR TIPO no service.
@Areas('dashboard')
@Controller('relatorios')
export class RelatoriosController {
  constructor(private readonly relatoriosService: RelatoriosService) {}

  @Get(':tipo/pdf')
  async pdf(@Param('tipo') tipo: string, @CurrentUser() user: AuthUser, @Res() res: Response) {
    const { doc, nome } = await this.relatoriosService.gerar(tipo, user);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nome}.pdf"`);
    doc.pipe(res);
    doc.end();
  }
}
