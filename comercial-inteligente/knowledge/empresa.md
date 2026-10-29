# HC Quality — contexto da empresa

> Separação obrigatória: **confirmado** (verificável neste repositório ou informado pela empresa) ×
> **a confirmar** (o responsável humano precisa fornecer). Agentes não completam lacunas por conta própria.

## Confirmado

- **HC QUALITY PROFESSIONAL WORKWEAR & HEALTH**, integrante do **Grupo Cherkesian**; domínio de e-mail `@hcqualitycorp.com.br`.
- Fabricante de uniformes profissionais, hospitalares e industriais (produção própria com OP, corte,
  costura, acabamento, expedição; uso de oficinas externas/facção — ver módulos `ops`, `kits`, `pcp` do ERP).
- O **Cherkesian ERP** (este repositório, NestJS + Prisma) já possui: cadastro de clientes (com
  unidades e grupos), CRM/funil de leads (`src/crm`), orçamentos e pedidos (`src/pedidos`), pilotos
  (amostras — cliente novo exige piloto aprovado antes da produção), OP, compras, estoque, expedição,
  NF-e, financeiro (contas a receber/pagar, fluxo, comissões), contratos e portal do cliente.
- O pedido de cliente novo passa por **piloto** antes de liberar produção: prazo comercial deve considerar essa etapa.
- Produtos têm ficha técnica, consumo de material (BOM), grade de tamanhos, cores, aplicações
  (bordado, DTF, silk) e campo de custo direto e preço base (`Produto.custo`, `Produto.precoBase`).
- Existe tabela especial de preço para tamanhos grandes (`precoEspecial`, `tamsEspeciais`) no ERP.

## A confirmar pelo responsável humano (necessário para produção)

- Capacidade produtiva mensal por etapa (corte, costura, acabamento) e lead time padrão por família de produto.
- Política comercial real: margem mínima, alçadas de desconto e valor, condições de pagamento padrão, validade de proposta.
- Alíquotas/regime tributário a usar como premissa de impostos sobre a venda (por filial/CNPJ emissor).
- Política de comissão (percentual e base).
- Certificações e documentos efetivamente válidos (CA de EPI, laudos de tecido, normas) — por produto.
- Mercados prioritários, regiões atendidas, valor mínimo de pedido, política de frete.
- Lista de clientes estratégicos e contas-chave.
- Concorrentes relevantes (somente informação verificável).

Enquanto esses itens não forem fornecidos, os relatórios os listam em **Dados ausentes**.
