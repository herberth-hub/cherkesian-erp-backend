import { Acesso, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const SALT_ROUNDS = 10;

/**
 * Seed de desenvolvimento — empresa + usuários iniciais (a partir de erp-data.js).
 * Idempotente: pode rodar várias vezes (upsert por login de usuário).
 * As senhas abaixo são as do protótipo; TROQUE em produção.
 */
interface SeedUser {
  nome: string;
  usuario: string;
  senha: string;
  acesso: Acesso;
  cargo: string;
  setor: string;
  horarioInicio: string | null;
  horarioFim: string | null;
}

const USUARIOS: SeedUser[] = [
  {
    nome: 'Herberth Cherkesian',
    usuario: 'admin',
    senha: 'cherkesian',
    acesso: 'total',
    cargo: 'Diretor / Administrador',
    setor: 'Gestão',
    horarioInicio: null, // Integral (sem restrição)
    horarioFim: null,
  },
  {
    nome: 'Camila Souza',
    usuario: 'camila',
    senha: 'vendas123',
    acesso: 'comercial',
    cargo: 'Vendas',
    setor: 'Comercial',
    horarioInicio: '08:00',
    horarioFim: '18:00',
  },
  {
    nome: 'Rogério Alves',
    usuario: 'rogerio',
    senha: 'pcp123',
    acesso: 'producao',
    cargo: 'Planejamento (PCP)',
    setor: 'PCP / Produção',
    horarioInicio: '07:00',
    horarioFim: '17:00',
  },
  {
    nome: 'Equipe Corte/Costura',
    usuario: 'fabrica',
    senha: 'chao123',
    acesso: 'chao',
    cargo: 'Chão de fábrica',
    setor: 'Produção',
    horarioInicio: '07:00',
    horarioFim: '17:00',
  },
  {
    nome: 'Marina Lima',
    usuario: 'marina',
    senha: 'exped123',
    acesso: 'expedicao',
    cargo: 'Logística',
    setor: 'Estoque / Expedição',
    horarioInicio: '08:00',
    horarioFim: '18:00',
  },
  {
    nome: 'Financeiro',
    usuario: 'financeiro',
    senha: 'fin123',
    acesso: 'financeiro',
    cargo: 'Contas',
    setor: 'Financeiro',
    horarioInicio: '09:00',
    horarioFim: '18:00',
  },
];

async function main(): Promise<void> {
  // Empresa (usa a primeira existente ou cria a GRUPO CHERKESIAN)
  const existente = await prisma.empresa.findFirst({ where: { nome: 'GRUPO CHERKESIAN' } });
  const empresa =
    existente ??
    (await prisma.empresa.create({
      data: { nome: 'GRUPO CHERKESIAN', regime: 'Lucro Presumido' },
    }));

  console.log(`Empresa: ${empresa.nome} (id=${empresa.id})`);

  for (const u of USUARIOS) {
    const senhaHash = await bcrypt.hash(u.senha, SALT_ROUNDS);
    const salvo = await prisma.usuario.upsert({
      where: { usuario: u.usuario },
      update: {
        nome: u.nome,
        acesso: u.acesso,
        cargo: u.cargo,
        setor: u.setor,
        horarioInicio: u.horarioInicio,
        horarioFim: u.horarioFim,
        senhaHash,
        empresaId: empresa.id,
        ativo: true,
      },
      create: {
        empresaId: empresa.id,
        nome: u.nome,
        usuario: u.usuario,
        senhaHash,
        acesso: u.acesso,
        cargo: u.cargo,
        setor: u.setor,
        horarioInicio: u.horarioInicio,
        horarioFim: u.horarioFim,
      },
    });
    console.log(`  usuario: ${salvo.usuario} (${salvo.acesso})`);
  }

  console.log('\nSeed concluído. Login admin: admin / cherkesian');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
