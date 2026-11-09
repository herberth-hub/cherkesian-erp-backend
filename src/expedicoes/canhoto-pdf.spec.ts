/**
 * CANHOTO ASSINADO: FOTO OU PDF.
 *
 * O canhoto é a PROVA DE ENTREGA. Vinha só como foto, porque o caso pensado era
 * o do motorista fotografando na porta do cliente. Mas a transportadora devolve
 * o comprovante digitalizado em PDF, por e-mail, e esse arquivo não tem como ser
 * "refeito menor" — chega pronto de fora.
 *
 * Como é prova, um PDF tem de ser PDF de verdade: um arquivo com o rótulo
 * trocado ficaria arquivado como comprovante e só se descobriria no dia em que
 * o cliente contestasse a entrega. Por isso o serviço confere a assinatura
 * %PDF- nos bytes, não o que o data URI diz ser.
 */
import { BadRequestException } from '@nestjs/common';
import { ExpedicoesService } from './expedicoes.service';

const PDF_OK = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.7\n1 0 obj\n').toString('base64');
const PDF_MENTIROSO = 'data:application/pdf;base64,' + Buffer.from('PK\u0003\u0004 isto aqui e um zip').toString('base64');
const FOTO = 'data:image/jpeg;base64,' + Buffer.from('\xff\xd8\xff\xe0').toString('base64');

function montar() {
  const expedicao = { id: 7, canhotoImg: null as string | null, canhotoEm: null as Date | null };
  const gravados: Array<Record<string, unknown>> = [];
  const guardados: string[] = [];
  const removidos: string[] = [];

  const prisma = {
    expedicao: {
      findUnique: jest.fn().mockResolvedValue(expedicao),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        gravados.push(data);
        return Promise.resolve({ ...expedicao, ...data });
      }),
    },
    cliente: { findUnique: jest.fn().mockResolvedValue({ id: 1, empresaId: 1 }) },
  };
  const arquivos = {
    guardar: jest.fn((uri: string) => { guardados.push(uri); return Promise.resolve('arq:canhotos/x.pdf'); }),
    remover: jest.fn((k: string) => { removidos.push(k); return Promise.resolve(); }),
    dataUri: jest.fn((k: string) => Promise.resolve(k === 'arq:canhotos/x.pdf' ? PDF_OK : FOTO)),
  };

  // ordem do construtor: prisma, bancos, arquivos
  const svc = new ExpedicoesService(
    prisma as never, {} as never, arquivos as never,
  );
  return { svc, expedicao, gravados, guardados, removidos, arquivos };
}

describe('canhoto assinado', () => {
  describe('o que o sistema ACEITA', () => {
    it('aceita o PDF que a transportadora manda', async () => {
      const { svc, guardados } = montar();
      await expect(svc.salvarCanhoto(7, 1, PDF_OK)).resolves.toMatchObject({ ok: true });
      expect(guardados).toEqual([PDF_OK]);
    });

    it('continua aceitando a foto do motorista', async () => {
      const { svc, guardados } = montar();
      await expect(svc.salvarCanhoto(7, 1, FOTO)).resolves.toMatchObject({ ok: true });
      expect(guardados).toEqual([FOTO]);
    });

    it('grava a data do arquivamento junto com o arquivo', async () => {
      const { svc, gravados } = montar();
      await svc.salvarCanhoto(7, 1, PDF_OK);
      expect(gravados[0]).toHaveProperty('canhotoImg');
      expect(gravados[0].canhotoEm).toBeInstanceOf(Date);
    });
  });

  describe('o que o sistema RECUSA', () => {
    it('recusa um arquivo que SE DIZ PDF mas não é — seria prova de entrega falsa', async () => {
      const { svc, guardados } = montar();
      await expect(svc.salvarCanhoto(7, 1, PDF_MENTIROSO)).rejects.toThrow(BadRequestException);
      await expect(svc.salvarCanhoto(7, 1, PDF_MENTIROSO)).rejects.toThrow(/não é um PDF válido/);
      expect(guardados).toHaveLength(0); // nada chega ao bucket
    });

    it('recusa qualquer outro tipo de arquivo', async () => {
      const { svc } = montar();
      const zip = 'data:application/zip;base64,' + Buffer.from('PK').toString('base64');
      await expect(svc.salvarCanhoto(7, 1, zip)).rejects.toThrow(/foto ou um PDF/);
    });

    it('recusa texto solto no lugar do arquivo', async () => {
      const { svc } = montar();
      await expect(svc.salvarCanhoto(7, 1, 'canhoto ok, recebido')).rejects.toThrow(/foto ou um PDF/);
      await expect(svc.salvarCanhoto(7, 1, '')).rejects.toThrow(/foto ou um PDF/);
    });

    it('recusa PDF grande demais, dizendo o que fazer', async () => {
      const { svc } = montar();
      const gigante = 'data:application/pdf;base64,' + 'A'.repeat(12_000_001);
      await expect(svc.salvarCanhoto(7, 1, gigante)).rejects.toThrow(/só a página do canhoto/);
    });

    it('o PDF cabe num arquivo maior que o limite da foto — é o motivo da mudança', async () => {
      // ~9 MB de PDF passa; a mesma coisa como imagem não passaria (limite ~6 MB).
      const { svc } = montar();
      const pdfGrande = PDF_OK + 'A'.repeat(9_000_000);
      await expect(svc.salvarCanhoto(7, 1, pdfGrande)).resolves.toMatchObject({ ok: true });
      const fotoGrande = FOTO + 'A'.repeat(9_000_000);
      await expect(svc.salvarCanhoto(7, 1, fotoGrande)).rejects.toThrow(/resolução menor/);
    });
  });

  describe('ao abrir o canhoto arquivado', () => {
    it('avisa a tela que é PDF, para abrir no visualizador e não como imagem', async () => {
      const { svc, expedicao } = montar();
      expedicao.canhotoImg = 'arq:canhotos/x.pdf';
      await expect(svc.getCanhoto(7, 1)).resolves.toMatchObject({ tipo: 'pdf' });
    });

    it('marca como imagem quando é foto', async () => {
      const { svc, expedicao } = montar();
      expedicao.canhotoImg = 'arq:canhotos/foto.jpg';
      await expect(svc.getCanhoto(7, 1)).resolves.toMatchObject({ tipo: 'imagem' });
    });
  });
});
