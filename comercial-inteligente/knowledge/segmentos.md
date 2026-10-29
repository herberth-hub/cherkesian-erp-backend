# Inteligência por segmento

Cada segmento traz: perfil de cliente ideal (ICP), dores de compra, produtos de entrada, potencial de
recorrência, perguntas de qualificação, argumentos **comprováveis**, objeções frequentes e próximo passo.

> Argumento comprovável = algo que a HC Quality consegue demonstrar com documento, amostra, ficha
> técnica, histórico de entrega ou referência autorizada. Se a prova não existe na base, o argumento
> não é usado — vira pendência para o responsável humano.

Código na CLI entre parênteses.

---

## 1. Hospitais, clínicas e redes de saúde (`saude`)

- **ICP**: hospitais com centro cirúrgico/UTI, redes de clínicas, laboratórios; >100 colaboradores assistenciais.
- **Dores**: reposição constante por desgaste em lavagem; cor/identificação por setor; grade ampla; falta de estoque na troca de turno; padronização entre unidades.
- **Entrada**: conjunto privativo, jaleco.
- **Recorrência**: alta (reposição anual ou semestral; contratos por unidade).
- **Perguntas**: quantos colaboradores por setor? qual a lavagem (própria ou lavanderia terceirizada; temperatura)? cores por setor? existe padrão de bordado? quem aprova (compras, enfermagem, SESMT)? há contrato vigente e quando vence?
- **Argumentos comprováveis**: ficha técnica do tecido; piloto antes da produção; grade completa incluindo tamanhos especiais; entrega por unidade (o ERP controla unidades do cliente).
- **Objeções**: "o atual fornecedor é mais barato" → comparar custo por ciclo de lavagem com ficha técnica, nunca só preço unitário; "precisamos de amostra" → fluxo de piloto.
- **Próximo passo**: levantar grade e setores; propor piloto para o setor de maior consumo.

## 2. Lavanderias hospitalares e industriais (`lavanderia`)

- **ICP**: lavanderias que fornecem enxoval/uniforme em locação para hospitais e indústrias.
- **Dores**: durabilidade em lavagem industrial; perda e rastreabilidade; volume com prazo previsível.
- **Entrada**: privativos, aventais e peças padronizadas em grande volume.
- **Recorrência**: muito alta (reposição contínua da frota de peças).
- **Perguntas**: volume mensal de reposição? processo de lavagem e química? exigência de identificação/etiqueta? prazo médio de reposição? forma de pagamento praticada?
- **Argumentos**: padronização de modelagem e tecido entre lotes; etiquetagem; programação de entregas recorrentes (conferir capacidade com PCP antes de oferecer).
- **Objeções**: "preciso de preço por volume" → formar preço com custo e margem (diretor); "prazo curto" → só com confirmação operacional.
- **Próximo passo**: proposta de fornecimento recorrente com cronograma sujeito à confirmação do PCP.

## 3. Indústrias de gás, energia, logística e manufatura (`industria`)

- **ICP**: plantas industriais, distribuidoras de gás, operadores logísticos, fabricantes com equipes de campo.
- **Dores**: identificação visual, durabilidade, refletivos, exigências do SESMT, troca periódica por norma interna.
- **Entrada**: calça e camisa de brim, polo bordada, macacão.
- **Recorrência**: média/alta (troca anual ou por desgaste; admissões).
- **Perguntas**: há exigência de EPI/CA para a peça? (se sim, validar documentação antes de qualquer promessa) quantos colaboradores por função? há refletivo? quem especifica (SESMT) e quem compra (suprimentos)?
- **Argumentos**: peças reforçadas e personalização com ficha técnica; entrega por planta.
- **Objeções**: "precisa ter CA" → **não afirmar**; verificar `produto.certificacoes`; se não houver, escalar.
- **Próximo passo**: reunião técnica com SESMT + suprimentos; amostra.

## 4. Empresas de limpeza, conservação e facilities (`facilities`)

- **ICP**: prestadoras com muitos postos de trabalho e contratos com tomadores.
- **Dores**: custo por colaborador, giro alto de pessoal, prazo para mobilizar novos contratos, grade variada.
- **Entrada**: camiseta/polo, calça, avental.
- **Recorrência**: alta (cada novo contrato do cliente gera pedido; reposição por turnover).
- **Perguntas**: quantos postos ativos? quantos novos contratos previstos? trocas por colaborador/ano? prazo típico de mobilização?
- **Argumentos**: kit padronizado por função; reposição programada; preço por kit (calculado com margem).
- **Objeções**: preço → mostrar custo total do kit e durabilidade com prova; prazo → confirmar com PCP.
- **Próximo passo**: proposta de kit por função e acordo de reposição.

## 5. Construção civil e manutenção (`construcao`)

- **ICP**: construtoras de médio/grande porte, empresas de manutenção predial e industrial.
- **Dores**: obras temporárias, mobilização rápida, identificação por empresa/terceiro.
- **Entrada**: camiseta, calça de brim, camisa manga longa.
- **Recorrência**: por obra (sazonal) — negociar acordo de fornecimento anual.
- **Perguntas**: número de obras e efetivo; calendário de mobilização; exigências de segurança da obra.
- **Argumentos**: kits por obra; personalização; entregas parciais (o ERP suporta faturamento parcial).
- **Objeções**: "compro no varejo" → personalização e padronização; preço.
- **Próximo passo**: kit padrão por obra com tabela de reposição.

## 6. Redes de serviços e empresas com equipes uniformizadas (`servicos`)

- **ICP**: redes de varejo, hotéis, restaurantes, clínicas de estética, transportadoras.
- **Dores**: identidade visual consistente entre unidades, reposição descentralizada.
- **Entrada**: polo, camisa social, avental.
- **Recorrência**: alta (novas unidades + reposição).
- **Perguntas**: número de unidades e colaboradores; manual de marca; quem compra (centralizado ou por unidade)?
- **Argumentos**: padronização entre lotes; portal do cliente do ERP para acompanhamento (confirmar com o humano se será oferecido).
- **Objeções**: prazo de novas unidades; preço por unidade isolada.
- **Próximo passo**: piloto com o manual de marca; acordo de reposição.

## 7. Distribuidores e revendedores (`distribuidores`)

- **ICP**: distribuidores de EPI/uniformes e revendas regionais.
- **Dores**: margem de revenda, prazo, mix, exclusividade regional.
- **Entrada**: linha padrão (polo, calça, jaleco) com grade completa.
- **Recorrência**: alta, mas sensível a preço.
- **Perguntas**: região e carteira atendida; volume mensal; exige marca própria? prazo de pagamento?
- **Argumentos**: fabricação própria, padrão de qualidade, personalização para os clientes do distribuidor.
- **Objeções**: preço de revenda → **política de preço para canal precisa ser definida pelo humano/diretor**; sem ela, escalar.
- **Próximo passo**: proposta de parceria condicionada à política de canal.

## 8. Órgãos públicos, licitações e contratos administrativos (`publico`)

- **ICP**: prefeituras, secretarias de saúde, hospitais públicos, autarquias.
- **Dores**: conformidade com edital, habilitação documental, preço de referência, entrega conforme cronograma do contrato.
- **Entrada**: conforme termo de referência do edital.
- **Recorrência**: contratos e atas de registro de preço (12 meses típicos).
- **Perguntas**: modalidade e data da sessão; exigências de habilitação; amostra exigida? prazo de entrega e penalidades; garantia contratual?
- **Argumentos**: somente documentação efetivamente disponível (certidões, atestados de capacidade técnica, fichas técnicas) — confirmar com o humano.
- **Objeções**: preço de referência abaixo do custo → **não participar** sem decisão do CEO/humano.
- **Próximo passo**: análise de edital (go/no-go) pelo diretor, decisão do CEO; participação e assinatura são do humano.
