/**
 * Envio do boleto por e-mail.
 *
 * O boleto só existia para download manual: alguém abria o PDF, anexava e
 * escrevia o e-mail à mão. Aqui o sistema manda, já preenchido, e registra que
 * a cobrança saiu.
 */
import { BancosService } from './bancos.service';

const PDF = { content: Buffer.from('%PDF-1.4 boleto'), filename: 'boleto-000000123.pdf', contentType: 'application/pdf' };

function servico(opts: { email?: string | null; informado?: string } = {}) {
  const enviados: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const prisma = {
    contaReceber: {
      findFirst: () => Promise.resolve({ id: 7, clienteId: 3, valor: 1000, pago: 250, vencimento: new Date('2026-11-05T12:00:00Z') }),
      update: (a: Record<string, unknown>) => { updates.push(a); return Promise.resolve({}); },
    },
    cliente: { findUnique: () => Promise.resolve({ nome: 'Memorial Hospital', email: 'email' in opts ? opts.email : 'financeiro@memorial.com.br' }) },
    boleto: {
      findFirst: () => Promise.resolve({
        nossoNumero: '000000123', nossoNumeroDv: '4', linhaDigitavel: '03399.12345 67890.123456 78901.234567 8 99990000075000',
        contaBancaria: { cedenteNome: 'YEREVAN TEXTIL', filial: { nome: 'Yerevan' } },
      }),
    },
  };
  const email = { enviar: (p: Record<string, unknown>) => { enviados.push(p); return Promise.resolve({ ok: true, simulado: false }); } };
  const svc = new BancosService(prisma as never, {} as never, email as never);
  (svc as unknown as { boletoPdf: () => Promise<unknown> }).boletoPdf = () => Promise.resolve(PDF);
  return { svc, enviados, updates };
}

describe('enviar boleto por e-mail', () => {
  it('usa o e-mail cadastrado do cliente e anexa o PDF do boleto', async () => {
    const { svc, enviados } = servico();
    const r = await svc.enviarBoletoPorEmail(7, 1);
    expect(r.para).toBe('financeiro@memorial.com.br');
    const e = enviados[0];
    expect(e.para).toBe('financeiro@memorial.com.br');
    expect((e.anexos as Array<{ filename: string }>)[0].filename).toBe(PDF.filename);
    // o corpo leva a linha digitável — é o que o cliente usa para pagar sem abrir o anexo
    expect(String(e.texto)).toContain('03399.12345');
    expect(String(e.texto)).toContain('Nosso número: 000000123-4');
  });

  it('cobra o SALDO, não o valor cheio do título', async () => {
    const { svc, enviados } = servico();
    const r = await svc.enviarBoletoPorEmail(7, 1);
    expect(r.valor).toBe(750); // 1000 - 250 já pago
    expect(String(enviados[0].texto)).toContain('750,00');
  });

  it('e-mail informado na tela tem prioridade sobre o cadastro', async () => {
    const { svc } = servico();
    const r = await svc.enviarBoletoPorEmail(7, 1, ' compras@outro.com.br ');
    expect(r.para).toBe('compras@outro.com.br');
  });

  it('cliente sem e-mail e nada informado: avisa em vez de enviar para o vazio', async () => {
    const { svc, enviados } = servico({ email: null });
    await expect(svc.enviarBoletoPorEmail(7, 1)).rejects.toThrow(/não tem e-mail cadastrado/i);
    expect(enviados).toHaveLength(0);
  });

  it('registra a cobrança enviada (régua não reenvia no mesmo dia)', async () => {
    const { svc, updates } = servico();
    await svc.enviarBoletoPorEmail(7, 1);
    const d = updates[0].data as Record<string, unknown>;
    expect(d.ultimaCobrancaEm).toBeInstanceOf(Date);
    expect(d.cobrancasEnviadas).toEqual({ increment: 1 });
  });

  it('cópia opcional vai no campo cc', async () => {
    const { svc, enviados } = servico();
    await svc.enviarBoletoPorEmail(7, 1, 'cliente@x.com', 'financeiro@hcquality.com.br');
    expect(enviados[0].cc).toBe('financeiro@hcquality.com.br');
  });
});
