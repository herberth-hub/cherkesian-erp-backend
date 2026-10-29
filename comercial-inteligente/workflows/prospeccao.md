# Workflow — Prospecção

**Dono:** Vendedor (execução) · Gerente (plano semanal e distribuição) · Diretor (estratégia por segmento)

## Entradas válidas de prospects
Listas fornecidas pelo responsável humano, leads do CRM do ERP (`erp importar --recurso leads`, humano),
clientes inativos da carteira (`pipeline inativos`), indicações registradas. **Agentes não inventam
empresas nem contatos** e, nesta configuração, não navegam na internet.

## Passos
1. **Diretor** define segmentos prioritários e metas de prospecção (com base em `knowledge/segmentos.md` e `pipeline concentracao` para reduzir dependência de poucos clientes).
2. **Gerente** distribui a semana: `tarefa criar --responsavel vendedor --titulo "Prospectar N empresas do segmento X" --prazo ... --condicao "N leads registrados com fonte e próximo passo"`.
3. **Vendedor**, para cada prospect da lista:
   - verifica duplicidade: `listar lead`, `listar cliente` (a CLI também recusa duplicado);
   - registra: `registrar lead --json '{"empresa":"...","segmento":"saude","fonte":"lista fornecida em AAAA-MM-DD","status":"novo","responsavelId":"AGT-...","cnpj":null,"cidadeUf":null}'`;
   - prepara abordagem (rascunho de e-mail/roteiro de ligação) com as perguntas do segmento — **para o humano enviar**.
4. Lead com interesse → `registrar oportunidade` (etapa `lead_qualificado` ou `contato_realizado`) com próximo passo e data.
5. Vendedor entrega a tarefa: `tarefa mover --status aguardando_aprovacao --evidencia "LEA-...; LEA-..."`; gerente verifica e conclui.

## Saída
Leads registrados, oportunidades com próximo passo, rascunhos de abordagem, pendências (contatos ausentes).
