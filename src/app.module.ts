import { join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
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
import { EstoqueModule } from './estoque/estoque.module';
import { ExpedicoesModule } from './expedicoes/expedicoes.module';
import { FinanceiroModule } from './financeiro/financeiro.module';
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
    EstoqueModule,
    ExpedicoesModule,
    FinanceiroModule,
    LogsModule,
    DashboardModule,
    PcpModule,
  ],
  controllers: [AppController],
  providers: [
    // Ordem importa: autentica -> checa RBAC -> checa horário comercial.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: BusinessHoursGuard },
    // Auditoria global de toda escrita.
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
