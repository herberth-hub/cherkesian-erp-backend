-- CreateEnum
CREATE TYPE "Acesso" AS ENUM ('total', 'comercial', 'producao', 'chao', 'expedicao', 'financeiro');

-- CreateEnum
CREATE TYPE "PedidoEtapa" AS ENUM ('orcamento', 'aprovado', 'piloto', 'material', 'compra', 'producao', 'estoque', 'expedicao');

-- CreateEnum
CREATE TYPE "PilotoStatus" AS ENUM ('em_desenvolvimento', 'enviada_ao_cliente', 'aprovada', 'aprovada_c_ajustes', 'reprovada');

-- CreateEnum
CREATE TYPE "OPStatus" AS ENUM ('aguardando_material', 'a_iniciar', 'em_corte', 'em_producao', 'em_faccao', 'concluido');

-- CreateEnum
CREATE TYPE "Prioridade" AS ENUM ('alta', 'media', 'baixa');

-- CreateEnum
CREATE TYPE "TituloStatus" AS ENUM ('a_vencer', 'vencendo', 'vencida', 'pago');

-- CreateEnum
CREATE TYPE "OCStatus" AS ENUM ('aguardando', 'recebida', 'cancelada');

-- CreateTable
CREATE TABLE "Empresa" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "regime" TEXT NOT NULL DEFAULT 'Lucro Presumido',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Empresa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Usuario" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "nome" TEXT NOT NULL,
    "usuario" TEXT NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "cargo" TEXT,
    "setor" TEXT,
    "acesso" "Acesso" NOT NULL DEFAULT 'comercial',
    "horarioInicio" TEXT,
    "horarioFim" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cliente" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "nome" TEXT NOT NULL,
    "fantasia" TEXT,
    "cnpjCpf" TEXT,
    "contato" TEXT,
    "telefone" TEXT,
    "email" TEXT,
    "cidadeUf" TEXT,
    "segmento" TEXT,
    "clienteNovo" BOOLEAN NOT NULL DEFAULT true,
    "obs" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fornecedor" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "nome" TEXT NOT NULL,
    "cnpjCpf" TEXT,
    "tipo" TEXT,
    "contato" TEXT,
    "telefone" TEXT,
    "cidadeUf" TEXT,
    "obs" TEXT,

    CONSTRAINT "Fornecedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Produto" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "cor" TEXT,
    "grade" TEXT,
    "precoBase" DECIMAL(12,2),

    CONSTRAINT "Produto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Material" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "cor" TEXT,
    "unidade" TEXT NOT NULL DEFAULT 'un',
    "saldo" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "minimo" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "custo" DECIMAL(12,2) NOT NULL DEFAULT 0,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consumo" (
    "id" SERIAL NOT NULL,
    "produtoId" INTEGER NOT NULL,
    "materialId" INTEGER NOT NULL,
    "quantidade" DECIMAL(12,4) NOT NULL,
    "unidade" TEXT NOT NULL,

    CONSTRAINT "Consumo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pedido" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "numero" TEXT NOT NULL,
    "clienteId" INTEGER NOT NULL,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valorTotal" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL,
    "formaPagamento" TEXT,
    "etapa" "PedidoEtapa" NOT NULL DEFAULT 'orcamento',
    "clienteNovo" BOOLEAN NOT NULL DEFAULT false,
    "obs" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoPor" TEXT,

    CONSTRAINT "Pedido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PedidoItem" (
    "id" SERIAL NOT NULL,
    "pedidoId" INTEGER NOT NULL,
    "produtoId" INTEGER,
    "descricao" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "valorUnit" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "PedidoItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Piloto" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "pedidoId" INTEGER NOT NULL,
    "clienteId" INTEGER NOT NULL,
    "produtoId" INTEGER,
    "solicitacao" TIMESTAMP(3),
    "envio" TIMESTAMP(3),
    "prazoRetorno" TIMESTAMP(3),
    "tentativa" INTEGER NOT NULL DEFAULT 1,
    "status" "PilotoStatus" NOT NULL DEFAULT 'em_desenvolvimento',
    "liberado" BOOLEAN NOT NULL DEFAULT false,
    "obs" TEXT,

    CONSTRAINT "Piloto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OP" (
    "id" SERIAL NOT NULL,
    "numero" TEXT NOT NULL,
    "pedidoId" INTEGER,
    "produtoId" INTEGER,
    "quantidade" INTEGER NOT NULL,
    "inicio" TIMESTAMP(3),
    "entregaPrev" TIMESTAMP(3),
    "status" "OPStatus" NOT NULL DEFAULT 'a_iniciar',
    "responsavel" TEXT,
    "setorAtual" TEXT,
    "progresso" INTEGER NOT NULL DEFAULT 0,
    "pilotoLiberado" BOOLEAN NOT NULL DEFAULT false,
    "prioridade" "Prioridade" NOT NULL DEFAULT 'media',

    CONSTRAINT "OP_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrdemCompra" (
    "id" SERIAL NOT NULL,
    "numero" TEXT NOT NULL,
    "fornecedorId" INTEGER NOT NULL,
    "materialId" INTEGER,
    "descricao" TEXT NOT NULL,
    "quantidade" DECIMAL(12,3) NOT NULL,
    "unidade" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "status" "OCStatus" NOT NULL DEFAULT 'aguardando',
    "previsao" TIMESTAMP(3),
    "motivo" TEXT,

    CONSTRAINT "OrdemCompra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Estoque" (
    "id" SERIAL NOT NULL,
    "produtoId" INTEGER NOT NULL,
    "tamanho" TEXT NOT NULL,
    "entradas" INTEGER NOT NULL DEFAULT 0,
    "saidas" INTEGER NOT NULL DEFAULT 0,
    "minimo" INTEGER NOT NULL DEFAULT 0,
    "localizacao" TEXT,

    CONSTRAINT "Estoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lote" (
    "id" SERIAL NOT NULL,
    "estoqueId" INTEGER NOT NULL,
    "codigoLote" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opId" INTEGER,

    CONSTRAINT "Lote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expedicao" (
    "id" SERIAL NOT NULL,
    "numero" TEXT NOT NULL,
    "pedidoId" INTEGER,
    "clienteId" INTEGER NOT NULL,
    "endereco" TEXT,
    "cidadeUf" TEXT,
    "cep" TEXT,
    "nf" TEXT,
    "transportadora" TEXT,
    "rastreio" TEXT,
    "volumes" INTEGER NOT NULL DEFAULT 1,
    "pecas" INTEGER NOT NULL,
    "loteId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'Separado',
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expedicao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContaReceber" (
    "id" SERIAL NOT NULL,
    "pedidoId" INTEGER,
    "clienteId" INTEGER NOT NULL,
    "vencimento" TIMESTAMP(3) NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "pago" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "TituloStatus" NOT NULL DEFAULT 'a_vencer',

    CONSTRAINT "ContaReceber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContaPagar" (
    "id" SERIAL NOT NULL,
    "fornecedorId" INTEGER,
    "categoria" TEXT NOT NULL,
    "referencia" TEXT,
    "vencimento" TIMESTAMP(3) NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "pago" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "TituloStatus" NOT NULL DEFAULT 'a_vencer',

    CONSTRAINT "ContaPagar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comissao" (
    "id" SERIAL NOT NULL,
    "pedidoId" INTEGER NOT NULL,
    "vendedor" TEXT NOT NULL,
    "valorVenda" DECIMAL(12,2) NOT NULL,
    "percentual" DECIMAL(5,4) NOT NULL,
    "comissao" DECIMAL(12,2) NOT NULL,
    "statusPgto" TEXT NOT NULL DEFAULT 'A pagar',

    CONSTRAINT "Comissao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Documento" (
    "id" SERIAL NOT NULL,
    "tipo" TEXT NOT NULL,
    "referencia" TEXT,
    "numero" TEXT NOT NULL,
    "urlPdf" TEXT,
    "geradoPor" TEXT,
    "geradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Documento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Log" (
    "id" SERIAL NOT NULL,
    "usuario" TEXT NOT NULL,
    "acao" TEXT NOT NULL,
    "detalhe" TEXT,
    "entidade" TEXT,
    "entidadeId" TEXT,
    "ip" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_usuario_key" ON "Usuario"("usuario");

-- CreateIndex
CREATE UNIQUE INDEX "Produto_codigo_key" ON "Produto"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "Material_codigo_key" ON "Material"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "Pedido_numero_key" ON "Pedido"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "Piloto_codigo_key" ON "Piloto"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "OP_numero_key" ON "OP"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "OrdemCompra_numero_key" ON "OrdemCompra"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "Estoque_produtoId_tamanho_key" ON "Estoque"("produtoId", "tamanho");

-- CreateIndex
CREATE UNIQUE INDEX "Expedicao_numero_key" ON "Expedicao"("numero");

-- AddForeignKey
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consumo" ADD CONSTRAINT "Consumo_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consumo" ADD CONSTRAINT "Consumo_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedidoItem" ADD CONSTRAINT "PedidoItem_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Piloto" ADD CONSTRAINT "Piloto_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OP" ADD CONSTRAINT "OP_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrdemCompra" ADD CONSTRAINT "OrdemCompra_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "Fornecedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estoque" ADD CONSTRAINT "Estoque_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lote" ADD CONSTRAINT "Lote_estoqueId_fkey" FOREIGN KEY ("estoqueId") REFERENCES "Estoque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lote" ADD CONSTRAINT "Lote_opId_fkey" FOREIGN KEY ("opId") REFERENCES "OP"("id") ON DELETE SET NULL ON UPDATE CASCADE;
