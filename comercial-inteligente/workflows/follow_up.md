# Workflow — Follow-up

**Dono:** Vendedor · Cobrança: Gerente

## Gatilhos (comandos)
- `pipeline sem-follow-up` — oportunidade sem próximo passo, sem data ou com data vencida.
- `pipeline parados` — sem contato há mais de `diasSemContatoParaAlerta` (premissa: 7 dias).
- `pipeline propostas-pendentes` — proposta enviada sem resposta há mais de `diasPropostaSemResposta` (5), ou perto de vencer.

## Cadência sugerida (sem insistência excessiva)
1. D+2 após envio: confirmação de recebimento e dúvidas.
2. D+5: retorno sobre objeções / ajuste técnico.
3. Antes da validade: aviso de vencimento.
4. Sem resposta após 3 tentativas: registrar `aguardando_decisao` com próximo contato em 30 dias, ou perda com motivo.

## Registro
- Cada contato: `registrar atividade --json '{"oportunidadeId":"OPO-...","responsavelId":"AGT-...","tipo":"email","data":"AAAA-MM-DD","resumo":"...","resultado":"sem_resposta"}'`.
- Atualizar `ultimoContatoEm`, `proximoPasso`, `proximoPassoEm` da oportunidade.
- Mensagens são **rascunhos** para o humano enviar.
