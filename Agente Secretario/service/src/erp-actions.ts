import { erp } from './erp';

/**
 * Ações de ESCRITA no ERP (Fase 3). Chamadas SOMENTE após aprovação humana
 * (pelo CLI). Cada função devolve um resumo legível do resultado.
 */

export async function gerarOp(pedidoId: number): Promise<string> {
  const r = (await erp.post(`/pedidos/${pedidoId}/gerar-op`)) as Record<string, unknown>;
  if (r.status === 'op_gerada') {
    const op = r.op as { numero: string; quantidade: number };
    return `OP ${op.numero} gerada (${op.quantidade} peças). Pedido em produção.`;
  }
  if (r.status === 'bloqueado_material') {
    const ocs = (r.ordensCompra as Array<{ numero: string }>) || [];
    return `Material insuficiente — ordem(ns) de compra criada(s): ${ocs.map((o) => o.numero).join(', ')}.`;
  }
  if (r.status === 'bloqueado_piloto') return 'Bloqueado: cliente novo exige peça-piloto liberada antes da OP.';
  return `Resposta: ${JSON.stringify(r).slice(0, 200)}`;
}

export async function criarOrdemCompra(dados: {
  fornecedorId: number;
  descricao: string;
  quantidade: number;
  unidade: string;
  valor: number;
  materialId?: number;
  previsao?: string;
  motivo?: string;
}): Promise<string> {
  const oc = (await erp.post('/ordens-compra', dados)) as { numero: string; valor: number };
  return `Ordem de compra ${oc.numero} criada (R$ ${Number(oc.valor).toFixed(2)}).`;
}

export async function emitirNfe(expedicaoId: number): Promise<string> {
  const n = (await erp.post('/nfe/emitir', { expedicaoId })) as Record<string, unknown>;
  const numero = n.numero ?? '—';
  if (n.status === 'rejeitada') return `NF-e ${numero} REJEITADA: ${String(n.motivo ?? '').slice(0, 200)}`;
  if (n.status === 'simulada') return `NF ${numero} emitida em MODO SIMULADO (sem valor fiscal).`;
  if (n.status === 'pendente') return `NF ${numero} enviada à SEFAZ (provedor ${n.provedor}) — aguardando autorização.`;
  return `NF ${numero} — status ${n.status}.`;
}

/** Gera um documento (PDF) no ERP e devolve numero + urlPdf. */
export async function gerarDocumento(tipo: string, refId: number): Promise<{ numero: string; urlPdf: string }> {
  const d = (await erp.post(`/documentos/${encodeURIComponent(tipo)}`, { referenciaId: refId })) as {
    numero: string;
    urlPdf: string;
  };
  return { numero: d.numero, urlPdf: d.urlPdf };
}

/** Gera o documento e o envia por e-mail (papel timbrado anexo) via ERP. */
export async function enviarDocumentoEmail(
  tipo: string,
  refId: number,
  para: string,
  assunto?: string,
  mensagem?: string,
): Promise<string> {
  const doc = (await erp.post(`/documentos/${encodeURIComponent(tipo)}`, { referenciaId: refId })) as { id: number; numero: string };
  const body: Record<string, unknown> = { para };
  if (assunto) body.assunto = assunto;
  if (mensagem) body.mensagem = mensagem;
  const r = (await erp.post(`/documentos/${doc.id}/enviar-email`, body)) as { simulado?: boolean };
  return r.simulado
    ? `Documento ${doc.numero} gerado; e-mail SIMULADO para ${para} (SMTP não configurado no ERP).`
    : `Documento ${doc.numero} enviado por e-mail para ${para}.`;
}
