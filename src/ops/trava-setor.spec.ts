/**
 * A TRAVA DE SETOR LIGADA NO SERVIÇO.
 *
 * O setores-op.spec prova a REGRA. Este prova que o serviço realmente a chama,
 * em cada caminho por onde uma OP se movimenta — regra certa num caminho que
 * ninguém consulta não protege nada.
 *
 * Também prova a parte que mais importa no dia do deploy: quem não tem setor
 * marcado continua movimentando tudo. Se isso quebrar, a fábrica para.
 */
import { ForbiddenException } from '@nestjs/common';
import { OpsService } from './ops.service';

type Estado = { id: number; numero: string; setorAtual: string | null; status: string; progresso: number; gradeFases: unknown; quantidade: number; gradeCortada: unknown; quantidadeCortada: number | null; corteParcial: boolean; gradeConcluida: unknown; quantidadeConcluida: number };

function servico(setoresDoUsuario: string[] | null) {
  const estado: Estado = {
    id: 516, numero: 'OP-0516', setorAtual: 'Costura', status: 'em_producao', progresso: 75,
    gradeFases: { Costura: { G: 10 } }, quantidade: 10,
    gradeCortada: { G: 10 }, quantidadeCortada: 10, corteParcial: false,
    gradeConcluida: null, quantidadeConcluida: 0,
  };
  const lidos: number[] = [];
  const prisma = {
    oP: {
      findUnique: () => Promise.resolve(estado),
      update: ({ data }: { data: Record<string, unknown> }) => { Object.assign(estado, data); return Promise.resolve({ ...estado }); },
    },
    usuario: {
      findUnique: ({ where }: { where: { id: number } }) => {
        lidos.push(where.id);
        return Promise.resolve(setoresDoUsuario === null ? null : { setoresOp: setoresDoUsuario });
      },
    },
    log: { create: () => Promise.resolve({}) },
  };
  const svc = new OpsService(prisma as never, {} as never);
  (svc as unknown as { findOne: () => Promise<unknown> }).findOne = () => Promise.resolve(estado);
  return { svc, estado, lidos };
}

const COSTUREIRA = ['costura'];
const CORTADOR = ['corte'];

describe('trava de setor no serviço de OPs', () => {
  describe('avançar fase', () => {
    it('a costura avança o que está na costura', async () => {
      const { svc } = servico(COSTUREIRA);
      await expect(svc.avancarFaseParcial(516, 'Costura', 'Acabamento', { G: 10 }, 1, 9)).resolves.toBeDefined();
    });

    it('o cortador NÃO avança o que está na costura', async () => {
      const { svc } = servico(CORTADOR);
      await expect(svc.avancarFaseParcial(516, 'Costura', 'Acabamento', { G: 10 }, 1, 9)).rejects.toThrow(ForbiddenException);
    });

    it('a trava olha a etapa de ORIGEM, não a de destino', async () => {
      // Quem entrega é quem terminou o serviço. O do acabamento não "puxa" da
      // costura: a costura é que entrega para ele.
      const { svc } = servico(['acabamento']);
      await expect(svc.avancarFaseParcial(516, 'Costura', 'Acabamento', { G: 10 }, 1, 9)).rejects.toThrow(/Costura/);
    });
  });

  describe('arrastar no kanban (updateStatus)', () => {
    it('recusa quando a OP está em etapa de outro setor', async () => {
      const { svc } = servico(CORTADOR);
      await expect(
        svc.updateStatus(516, { status: 'em_producao', setorAtual: 'Corte' } as never, 1, 9),
      ).rejects.toThrow(ForbiddenException);
    });

    it('aceita quando a OP está na etapa do próprio setor', async () => {
      const { svc } = servico(COSTUREIRA);
      await expect(
        svc.updateStatus(516, { status: 'em_producao', setorAtual: 'Acabamento' } as never, 1, 9),
      ).resolves.toBeDefined();
    });
  });

  describe('apontar corte', () => {
    it('é do corte, mesmo que a OP já esteja adiante', async () => {
      const { svc } = servico(COSTUREIRA);
      await expect(svc.registrarCorte(516, { G: 10 }, undefined, 1, 9)).rejects.toThrow(/Corte/);
    });

    it('o cortador aponta corte', async () => {
      const { svc } = servico(CORTADOR);
      await expect(svc.registrarCorte(516, { G: 10 }, undefined, 1, 9)).resolves.toBeDefined();
    });
  });

  describe('fechar peça (conclusão parcial)', () => {
    it('recusa quem não responde pela etapa onde a OP está', async () => {
      const { svc } = servico(CORTADOR);
      await expect(svc.concluirParcial(516, { G: 10 }, 1, { usuarioId: 9 })).rejects.toThrow(ForbiddenException);
    });
  });

  describe('desligada por padrão — a parte que não pode quebrar', () => {
    it('sem setor marcado, movimenta tudo', async () => {
      const { svc } = servico([]);
      await expect(svc.avancarFaseParcial(516, 'Costura', 'Acabamento', { G: 10 }, 1, 9)).resolves.toBeDefined();
    });

    it('usuário que nem existe mais não trava a produção', async () => {
      const { svc } = servico(null);
      await expect(svc.avancarFaseParcial(516, 'Costura', 'Acabamento', { G: 10 }, 1, 9)).resolves.toBeDefined();
    });

    it('sem usuário identificado (rotina interna/script) não consulta nem trava', async () => {
      const { svc, lidos } = servico(CORTADOR);
      await expect(svc.avancarFaseParcial(516, 'Costura', 'Acabamento', { G: 10 }, 1)).resolves.toBeDefined();
      expect(lidos).toHaveLength(0); // nem foi ao banco
    });
  });

  it('lê os setores do BANCO, não do token — tirar acesso vale na hora', async () => {
    const { svc, lidos } = servico(CORTADOR);
    await expect(svc.avancarFaseParcial(516, 'Costura', 'Acabamento', { G: 10 }, 1, 9)).rejects.toThrow();
    expect(lidos).toEqual([9]);
  });
});
