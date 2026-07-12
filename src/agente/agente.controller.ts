import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsArray, IsIn, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AgenteService } from './agente.service';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

class ChatMsgDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  @MaxLength(8000)
  content!: string;
}

class ChatDto {
  @IsString()
  @MaxLength(4000)
  mensagem!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatMsgDto)
  historico?: ChatMsgDto[];
}

class ExecutarDto {
  @IsIn(['criar_cliente', 'criar_orcamento', 'aprovar_pedido', 'gerar_op'])
  tipo!: string;

  @IsObject()
  dados!: Record<string, unknown>;
}

// Disponível para os perfis de escritório (todos que enxergam o dashboard).
@Areas('dashboard')
@Controller('agente')
export class AgenteController {
  constructor(private readonly agenteService: AgenteService) {}

  @Get('status')
  status() {
    return { configurado: this.agenteService.configurado() };
  }

  @Post('chat')
  chat(@Body() dto: ChatDto, @CurrentUser() user: AuthUser) {
    return this.agenteService.chat(user, dto.mensagem, dto.historico ?? []);
  }

  @Post('executar')
  executar(@Body() dto: ExecutarDto, @CurrentUser() user: AuthUser) {
    return this.agenteService.executar(user, dto.tipo, dto.dados);
  }
}
