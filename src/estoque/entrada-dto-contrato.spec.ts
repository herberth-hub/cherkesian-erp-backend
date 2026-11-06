/**
 * CONTRATO DA TELA x DTO DE ENTRADA.
 *
 * O ValidationPipe global roda com `forbidNonWhitelisted: true`: um campo que a
 * tela manda e o DTO não declara não é ignorado — derruba a requisição inteira
 * com "property X should not exist".
 *
 * Foi o que aconteceu com `somarSaldo` na emissão de etiquetas de rolo: a nota
 * de entrada ficava lançada (saldo somado) e NENHUMA etiqueta saía, com um toast
 * de erro que não dizia nada ao usuário. Os campos de segunda linha
 * (`qualidade`/`defeito`), que o serviço trata desde sempre, estavam no mesmo
 * buraco.
 *
 * Este teste roda os corpos EXATOS que o public/index.html monta. Se alguém
 * acrescentar um campo na tela sem declarar no DTO, ou tirar um do DTO que a
 * tela ainda manda, ele quebra aqui — e não na frente do usuário.
 */
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { EntradaEstoqueDto } from './dto/unidade.dto';

/** Mesma configuração do ValidationPipe global (src/main.ts). */
function validar(corpo: Record<string, unknown>) {
  const dto = plainToInstance(EntradaEstoqueDto, corpo, { enableImplicitConversion: true });
  return validateSync(dto as object, {
    whitelist: true,
    forbidNonWhitelisted: true,
  }).flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('corpos que a tela manda para POST /estoque/entrada', () => {
  it('etiqueta de rolo vinda da nota de entrada (somarSaldo: false)', () => {
    expect(
      validar({
        tipo: 'materia',
        descricao: 'BRIM PROFISSIONAL LEVE VINATEX',
        quantidade: 1,
        origem: 'entrada',
        destino: 'estoque',
        somarSaldo: false,
        materialId: 12,
        loteFornecedor: 'L-884',
      }),
    ).toEqual([]);
  });

  it('entrada manual de peça que já nasce de segunda linha', () => {
    expect(
      validar({
        tipo: 'produto',
        quantidade: 12,
        descricao: 'CAMISETA GOLA CARECA',
        cor: 'PRETO',
        tamanho: 'G',
        destino: 'estoque',
        coluna: 'A',
        andar: '3',
        caixaMaster: 'CX12',
        qualidade: 'segunda',
        defeito: 'Mancha leve na barra',
      }),
    ).toEqual([]);
  });

  it('peças vindas da conclusão de OP, reservadas para um pedido', () => {
    expect(
      validar({
        tipo: 'produto',
        descricao: 'CALCA MECANICO',
        ref: 'PRD-CAL-0012',
        cor: 'CAQUI',
        tamanho: 'M',
        quantidade: 40,
        origem: 'producao',
        destino: 'expedicao',
        loteEntrada: 'OP-473',
        produtoId: 7,
        pedidoId: 202,
      }),
    ).toEqual([]);
  });

  it('comodato: o endereço é o cliente, não a prateleira', () => {
    expect(
      validar({
        tipo: 'produto',
        descricao: 'JALECO',
        quantidade: 5,
        destino: 'estoque',
        coluna: 'COM',
        comodatoClienteId: 77,
      }),
    ).toEqual([]);
  });

  /** A trava continua valendo para campo que ninguém declarou — não virou passe livre. */
  it('campo desconhecido continua sendo recusado', () => {
    expect(validar({ tipo: 'materia', quantidade: 1, campoInventado: 'x' }))
      .toContain('property campoInventado should not exist');
  });
});
