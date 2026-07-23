import { join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsuariosModule } from './usuarios/usuarios.module';
import { ClientesModule } from './clientes/clientes.module';
import { FornecedoresModule } from './fornecedores/fornecedores.module';
import { ProdutosModule } from './produtos/produtos.module';
import { MateriaisModule } from './materiais/materiais.module';
import { ConsumoModule } from './consumo/consumo.module';
import { PedidosModule } from './pedidos/pedidos.module';
import { PilotosModule } from './pilotos/pilotos.module';
import { ComprasModule } from './compras/compras.module';
import { OpsModule } from './ops/ops.module';
import { KitsModule } from './kits/kits.module';
import { BiModule } from './bi/bi.module';
import { EstoqueModule } from './estoque/estoque.module';
import { ExpedicoesModule } from './expedicoes/expedicoes.module';
import { FinanceiroModule } from './financeiro/financeiro.module';
import { MedidasModule } from './medidas/medidas.module';
import { DocumentosModule } from './documentos/documentos.module';
import { EmailModule } from './email/email.module';
import { NfeModule } from './nfe/nfe.module';
import { NotasEntradaModule } from './notas-entrada/notas-entrada.module';
import { CreditoModule } from './credito/credito.module';
import { EmpresaModule } from './empresa/empresa.module';
import { FiliaisModule } from './filiais/filiais.module';
import { AgenteModule } from './agente/agente.module';
import { RelatoriosModule } from './relatorios/relatorios.module';
import { LogsModule } from './logs/logs.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { PcpModule } from './pcp/pcp.module';
import { AppController } from './app.controller';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { BusinessHoursGuard } from './common/guards/business-hours.guard';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';

@Module({
  imports: [
    // envFilePath fixo torna o .env independente do diretório de execução;
    // em produção (Render) não há arquivo .env e usa-se process.env normalmente.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: join(__dirname, '..', '.env') }),
    // Rate limiting (anti brute-force / abuso): 200 req / 60s por IP (padrão global).
    // Rotas sensíveis (login) apertam esse limite via @Throttle no controller.
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 200 }]),
    // Serve o frontend (public/) na raiz; a API fica sob /api/v1.
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      exclude: ['/api/(.*)'],
    }),
    PrismaModule,
    AuthModule,
    UsuariosModule,
    ClientesModule,
    FornecedoresModule,
    ProdutosModule,
    MateriaisModule,
    ConsumoModule,
    PedidosModule,
    PilotosModule,
    ComprasModule,
    OpsModule,
    KitsModule,
    BiModule,
    EstoqueModule,
    ExpedicoesModule,
    FinanceiroModule,
    MedidasModule,
    EmailModule,
    DocumentosModule,
    NfeModule,
    NotasEntradaModule,
    CreditoModule,
    EmpresaModule,
    FiliaisModule,
    AgenteModule,
    RelatoriosModule,
    LogsModule,
    DashboardModule,
    PcpModule,
  ],
  controllers: [AppController],
  providers: [
    // Rate limit ANTES de tudo (barra brute-force/abuso mesmo em rota pública).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Ordem importa: autentica -> checa RBAC -> checa horário comercial.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: BusinessHoursGuard },
    // Auditoria global de toda escrita.
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
