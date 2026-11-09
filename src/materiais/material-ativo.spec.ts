/**
 * MATERIAL INATIVO — cadastro velho/duplicado que não se compra mais.
 *
 * Existe porque o cadastro acumulou item genérico sem medida nem preço (os
 * "ZÍPER - VERDE BANDEIRA" da vida, a R$ 0,00) convivendo com o artigo de
 * verdade. Os dois apareciam lado a lado na hora de escolher, e escolher o
 * errado só se descobre na nota ou no custo da peça.
 *
 * Inativar NÃO apaga: nota, receita (BOM) e OC antigas continuam apontando para
 * ele. O que muda é que ele some das listas que OFERECEM material.
 */
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { MateriaisService } from './materiais.service';
import { UpdateMaterialDto } from './dto/update-material.dto';

/** Mesma configuração do ValidationPipe global (src/main.ts). */
function validar(corpo: Record<string, unknown>) {
  const dto = plainToInstance(UpdateMaterialDto, corpo, { enableImplicitConversion: true });
  return validateSync(dto as object, { whitelist: true, forbidNonWhitelisted: true })
    .flatMap((e) => Object.values(e.constraints ?? {}));
}

function servico() {
  const chamadas: Array<Record<string, unknown>> = [];
  const prisma = {
    material: {
      findMany: (args: Record<string, unknown>) => { chamadas.push(args); return Promise.resolve([]); },
      findUnique: () => Promise.resolve({ id: 1, empresaId: 1 }),
      update: (args: Record<string, unknown>) => { chamadas.push(args); return Promise.resolve({ id: 1 }); },
    },
  };
  return { svc: new MateriaisService(prisma as never), chamadas };
}

describe('o corpo que o botão Inativar manda', () => {
  it('é aceito pelo DTO (sem ele, o pipe derrubava a requisição inteira)', () => {
    expect(validar({ ativo: false })).toEqual([]);
    expect(validar({ ativo: true })).toEqual([]);
  });

  it('campo desconhecido continua recusado — não virou passe livre', () => {
    expect(validar({ ativo: false, inventado: 1 })).toContain('property inventado should not exist');
  });

  /**
   * ARMADILHA: o pipe global roda com `enableImplicitConversion`, e a conversão
   * para boolean é "qualquer string não vazia vira true" — inclusive a string
   * "false". Quem mandar `ativo: "false"` ATIVA o material em vez de inativar.
   * Por isso a tela manda booleano de verdade (`!!ativar`), nunca texto.
   */
  it('string "false" vira TRUE — a tela precisa mandar booleano de verdade', () => {
    const dto = plainToInstance(UpdateMaterialDto, { ativo: 'false' }, { enableImplicitConversion: true });
    expect(dto.ativo).toBe(true);
    expect(validar({ ativo: 'false' })).toEqual([]); // passa na validação, e é esse o perigo
    const certo = plainToInstance(UpdateMaterialDto, { ativo: false }, { enableImplicitConversion: true });
    expect(certo.ativo).toBe(false);
  });
});

describe('quem vê material inativo', () => {
  it('a lista que OFERECE material pede só os ativos', async () => {
    const { svc, chamadas } = servico();
    await svc.findAll(1);
    expect(chamadas[0].where).toEqual({ empresaId: 1, ativo: true });
  });

  it('a tela de CADASTRO pede todos, p/ poder reativar', async () => {
    const { svc, chamadas } = servico();
    await svc.findAll(1, true);
    expect(chamadas[0].where).toEqual({ empresaId: 1 });
  });

  it('o alerta de estoque mínimo ignora inativo — ninguém repõe o que saiu de linha', async () => {
    const { svc, chamadas } = servico();
    await svc.abaixoDoMinimo(1);
    expect(chamadas[0].where).toEqual({ empresaId: 1, ativo: true });
  });

  it('inativar grava o campo, e não apaga nada', async () => {
    const { svc, chamadas } = servico();
    await svc.update(1, { ativo: false }, 1);
    const update = chamadas.find((c) => c.data) as { data: Record<string, unknown> };
    expect(update.data.ativo).toBe(false);
    // o update manda os outros campos como undefined (Prisma ignora), nunca null
    expect(Object.values(update.data).filter((v) => v === null)).toEqual([]);
  });
});
