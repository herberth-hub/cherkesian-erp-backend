# Portfólio de produtos

Fonte de verdade de preço e custo: cadastro de **produto** na base (`listar produto`), alimentado pelo
responsável humano ou pela importação do ERP (`Produto.precoBase` → `precoAutorizado`,
`Produto.custo` → `custoVariavelUnitario`). Este documento descreve as famílias e o que considerar
tecnicamente — **não contém preços**.

| Categoria (CLI) | Família | Aplicações típicas | Pontos técnicos a levantar |
| --- | --- | --- | --- |
| `camiseta_polo` | Camisetas e polos | serviços, facilities, indústria, eventos | malha (PV, algodão, piquet), gramatura, gola/punho, bordado/silk/DTF, grade |
| `camisa_social` | Camisas sociais | recepção, administrativo, redes de serviço | tecido (tricoline, oxford), manga, modelagem fem./masc., bordado |
| `calca` | Calças profissionais | indústria, manutenção, construção, limpeza | brim/sarja, gramatura, elástico/cós, bolsos, refletivo |
| `jaleco` | Jalecos | saúde, laboratórios, estética, ensino | gabardine/microfibra, comprimento, manga, bolsos, bordado de nome |
| `avental` | Aventais | cozinha, lavanderia, limpeza, indústria alimentícia | tecido/impermeabilidade, amarração, bolsos |
| `privativo_hospitalar` | Conjuntos privativos | centro cirúrgico, UTI, hospitais, clínicas | tecido, cor por setor, decote, grade ampla, resistência a lavagem industrial |
| `macacao` | Macacões | indústria, gás, energia, manutenção, logística | tecido, zíper/botão, refletivo, reforços — **não presumir proteção certificada** |
| `personalizado` | Uniformes sob medida | redes, contratos com identidade visual | modelagem nova ⇒ piloto, ficha técnica, aprovação técnica |
| `protecao_acessorio` | Peças/acessórios de proteção | conforme portfólio **confirmado** | só ofertar o que estiver cadastrado e documentado |

## Regras de comunicação sobre produto

1. **Certificação**: nenhuma peça é EPI, tem CA ou atende norma (NR, ABNT, ISO) sem registro em
   `produto.certificacoes` com `validadoDocumento: true` e documento identificado. Sem isso, a resposta
   ao cliente é "vamos verificar a documentação aplicável" e a pendência é escalada.
2. **Prazo**: depende de matéria-prima, piloto (cliente novo), capacidade e oficinas externas — sempre
   "sujeito à confirmação operacional" até o PCP confirmar (`prazoEntrega.confirmadoOperacao`).
3. **Estoque/pronta entrega**: só afirmar com consulta ao ERP (módulo estoque) feita pelo humano.
4. **Lavanderia industrial/hospitalar**: perguntar processo de lavagem (temperatura, química) antes de
   indicar tecido — é um argumento técnico forte, mas precisa de ficha técnica que o comprove.
5. **Tamanhos grandes**: o ERP tem tabela especial; confirmar se a grade do cliente inclui esses tamanhos.
