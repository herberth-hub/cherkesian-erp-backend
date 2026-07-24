import { Controller, Get, Param } from '@nestjs/common';
import { LookupService } from './lookup.service';

/** Consulta de CNPJ/CEP para autopreenchimento de cadastros (requer login). */
@Controller('lookup')
export class LookupController {
  constructor(private readonly lookup: LookupService) {}

  @Get('cnpj/:cnpj')
  cnpj(@Param('cnpj') cnpj: string) {
    return this.lookup.cnpj(cnpj);
  }

  @Get('cep/:cep')
  cep(@Param('cep') cep: string) {
    return this.lookup.cep(cep);
  }
}
