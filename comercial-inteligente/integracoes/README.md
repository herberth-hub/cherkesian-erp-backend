# Integrações

| Integração | Situação | Requisito |
| --- | --- | --- |
| **ERP Cherkesian — leitura** (`erp.js`): clientes, produtos (preço base e custo), pedidos, leads do CRM | Implementada e testada com cliente HTTP simulado. **Não exercitada contra o ERP real** nesta entrega. | `ERP_API_URL`, `ERP_USUARIO`, `ERP_SENHA` no ambiente; usuário do ERP com perfil `comercial` |
| ERP — escrita (lançar pedido, atualizar lead) | **Não implementada** de propósito: pedido é lançado pelo humano no ERP | decisão do responsável humano + desenvolvimento |
| Financeiro (inadimplência, exposição, crédito) | Não implementada — relatórios declaram "dado ausente" | rotas `/financeiro/receber` e `/credito` do ERP + mapeamento |
| PCP / capacidade produtiva | Não implementada — relatórios declaram "dado ausente" | rotas do módulo `pcp` do ERP + regra de capacidade |
| E-mail / WhatsApp / agenda | Não integrada aos agentes comerciais (envio é humano). O serviço `Agente Secretario/` do repositório tem Gmail/Agenda com aprovação humana. | decisão do responsável humano |
| CRM externo (HubSpot, Salesforce...) | Não implementada | nova implementação da interface de `src/store.js` |

## Uso (responsável humano)

```bash
export ERP_API_URL=https://<host-do-erp>/api/v1 ERP_USUARIO=<usuario> ERP_SENHA=<senha>
node comercial-inteligente/bin/hc.js erp importar --recurso clientes --agente humano
node comercial-inteligente/bin/hc.js erp importar --recurso produtos --agente humano
node comercial-inteligente/bin/hc.js erp importar --recurso pedidos  --agente humano
node comercial-inteligente/bin/hc.js erp importar --recurso leads    --agente humano --responsavel AGT-0001
```

A importação casa registros por `erpId` (reimportar atualiza, não duplica), ignora orçamentos (não são
pedidos confirmados), nunca presume certificação de produto e relata registros inválidos em vez de corrigi-los.
