-- Novo perfil de acesso para a contabilidade (relatorios fiscais/financeiros)
ALTER TYPE "Acesso" ADD VALUE IF NOT EXISTS 'contabilidade';
