import { Controller, Get, Param, Query, Res } from '@nestjs/common';
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

  /** Filtros comuns a PDF/Excel — `comp` (AAAA-MM) e `filialId` são o que a contabilidade usa. */
  private filtros(de?: string, ate?: string, status?: string, filialId?: string, comp?: string) {
    return { de, ate, status, comp, filialId: filialId ? Number(filialId) : undefined };
  }

  /** Empresas (CNPJs emissores) disponíveis para recortar o relatório. */
  @Get('empresas')
  empresas(@CurrentUser() user: AuthUser) {
    return this.relatoriosService.empresas(user.empresaId);
  }

  @Get(':tipo/pdf')
  async pdf(
    @Param('tipo') tipo: string,
    @Query('de') de: string | undefined,
    @Query('ate') ate: string | undefined,
    @Query('status') status: string | undefined,
    @Query('filialId') filialId: string | undefined,
    @Query('comp') comp: string | undefined,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const { doc, nome } = await this.relatoriosService.gerar(tipo, user, this.filtros(de, ate, status, filialId, comp));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nome}.pdf"`);
    doc.pipe(res);
    doc.end();
  }

  @Get(':tipo/xlsx')
  async xlsx(
    @Param('tipo') tipo: string,
    @Query('de') de: string | undefined,
    @Query('ate') ate: string | undefined,
    @Query('status') status: string | undefined,
    @Query('filialId') filialId: string | undefined,
    @Query('comp') comp: string | undefined,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const { buffer, nome } = await this.relatoriosService.xlsx(tipo, user, this.filtros(de, ate, status, filialId, comp));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}.xlsx"`);
    res.send(buffer);
  }

  /**
   * XMLs das NF-e da competência num ZIP — é o arquivo que a contabilidade pede
   * todo mês. Sem isso a nota tem que ser baixada uma a uma.
   */
  @Get('xml/competencia')
  async xmlCompetencia(
    @Query('comp') comp: string | undefined,
    @Query('de') de: string | undefined,
    @Query('ate') ate: string | undefined,
    @Query('filialId') filialId: string | undefined,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const { buffer, nome, total } = await this.relatoriosService.xmlZip(user, this.filtros(de, ate, undefined, filialId, comp));
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('X-Total-Notas', String(total));
    res.setHeader('Content-Disposition', `attachment; filename="${nome}.zip"`);
    res.send(buffer);
  }
}
