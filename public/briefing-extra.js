// Produtos de briefing que NAO estao no Briefing_Peca_Piloto_Yerevan_HC.xlsx.
// Ficam aqui, e nao no briefing-schema.js, para que regenerar o Excel nao os apague.
// As secoes comuns (identificacao, cliente, prazos, referencia, personalizacao,
// aviamentos, qualidade, custo, aprovacao) sao COPIADAS do schema gerado, entao
// seguem o Excel automaticamente — aqui so se descreve o que e proprio da peca.
(function(){
  if(!window.BRIEFING_SCHEMA || !window.BRIEFING_PRODUTOS) return;

  // de onde vem as secoes comuns: qualquer produto do Excel serve
  const REF = window.BRIEFING_SCHEMA['BLAZER'] || window.BRIEFING_SCHEMA[window.BRIEFING_PRODUTOS[0]];
  if(!REF) return;

  const T  = (id,label,ex,obrig,resp)=>({id,label,tipo:'Texto',obrig:obrig||'S',resp:resp||'Comercial',ex});
  const NU = (id,label,unid,ex,obrig,resp)=>({id,label,tipo:'Número',unid,obrig:obrig||'S',resp:resp||'Modelagem',ex});
  const L  = (id,label,opcoes,ex,obrig,resp)=>({id,label,tipo:'Lista',obrig:obrig||'S',opcoes,resp:resp||'Comercial',ex});
  const LM = (id,label,opcoes,ex,obrig,resp)=>({id,label,tipo:'Lista múltipla',obrig:obrig||'N',opcoes,resp:resp||'Compras',ex});

  const TRATAMENTOS = ['Nenhum','Pré-encolhido','Antipilling','Antimicrobiano','Proteção UV',
    'Secagem rápida (dry)','Repelente a líquidos','Hidrorrepelente','Antiestático','Anti-rugas','Stretch','Amaciado'];

  const n = (p,i)=> p+'-'+String(i).padStart(3,'0');

  /** Bloco de tecido: igual para todas as pecas, muda a lista de artigos. */
  function tecido(titulo, pref, ini, tipos, exTipo, composicoes, exComp, exGram, extras){
    let i = ini;
    const c = [
      L (n(pref,i++),'Origem do tecido',['Fornecedor externo','Fornecido pelo cliente'],'Fornecedor externo','S','Compras'),
      T (n(pref,i++),'Fornecedor / artigo / referência','Fornecedor X – art. 1234','Cond.','Compras'),
      L (n(pref,i++),'Tipo de tecido',tipos,exTipo,'S','Compras'),
      L (n(pref,i++),'Composição',composicoes,exComp,'S','Compras'),
      NU(n(pref,i++),'Gramatura','g/m²',exGram,'S','Compras'),
      T (n(pref,i++),'Cor (nome + Pantone TCX)','Branco – Pantone 11-0601 TCX','S','Comercial'),
      LM(n(pref,i++),'Tratamentos / acabamentos do tecido',TRATAMENTOS,'Antimicrobiano; Repelente a líquidos'),
    ];
    (extras||[]).forEach(f => c.push(f(n(pref,i++))));
    return { sec: titulo, campos: c };
  }

  /** Monta o produto: comuns do Excel + modelo e tecido proprios. */
  function registrar(nome, modelo, tec, medidas){
    if(window.BRIEFING_SCHEMA[nome]) return;             // ja veio do Excel: nao sobrescreve
    const comuns = JSON.parse(JSON.stringify(REF)).filter(s => !/MODELO|TECIDO|DETALHES POR TIPO/.test(s.sec));
    window.BRIEFING_SCHEMA[nome] = [...comuns.slice(0,4), modelo, tec, ...comuns.slice(4)];
    window.BRIEFING_MED[nome] = medidas;
    window.BRIEFING_PRODUTOS.push(nome);
  }

  /* ----------------------------------------------------------- MACACÃO */
  registrar('MACACÃO',
    { sec:'5. MODELO – MACACÃO', campos:[
      L ('MAC-001','Tipo de macacão',['Macacão sanitário / hospitalar','Macacão operacional (trabalho)','Macacão de pintura / descartável','Jardineira','Macacão feminino social'],'Macacão sanitário / hospitalar'),
      L ('MAC-002','Modelagem',['Unissex','Masculina','Feminina'],'Unissex'),
      L ('MAC-003','Manga',['Manga longa','Manga curta','Manga 3/4','Sem manga (cava)'],'Manga longa'),
      L ('MAC-004','Fechamento frontal',['Zíper até o pescoço','Zíper com pala sobreposta','Botões de pressão','Velcro','Botões comuns'],'Zíper com pala sobreposta'),
      L ('MAC-005','Gola',['Gola padre','Gola esporte (camisa)','Capuz fixo','Capuz removível','Sem gola (careca)'],'Gola padre'),
      L ('MAC-006','Punho da manga',['Elástico','Punho com botão','Punho sanfonado','Com velcro de ajuste','Reto sem acabamento'],'Elástico','S','Modelagem'),
      L ('MAC-007','Ajuste na cintura',['Elástico total','Elástico só nas costas','Cós com cordão','Faixa com fivela','Sem ajuste'],'Elástico só nas costas','S','Modelagem'),
      L ('MAC-008','Bolsos',['Sem bolso','2 frontais (faca)','2 frontais + 1 no peito','2 frontais + 2 traseiros','Multibolsos (cargo)'],'2 frontais + 1 no peito'),
      L ('MAC-009','Barra da perna',['Reta','Com elástico','Com zíper lateral','Com velcro de ajuste'],'Com elástico','S','Modelagem'),
      L ('MAC-010','Faixa refletiva',['Não','Peito e costas','Peito, costas e pernas','Conforme NBR 15292'],'Não'),
      LM('MAC-011','Reforços',['Nenhum','Joelhos','Entrepernas','Cotovelos','Costuras de carga'],'Entrepernas','N','Modelagem'),
      L ('MAC-012','Tipo de costura',['Overloque + galoneira','Dupla agulha (fechada)','Costura selada (sem furo de agulha)','Interlock'],'Overloque + galoneira','S','Modelagem'),
      T ('MAC-013','Zíper / aviamentos (marca, tipo, tamanho, cor)','Zíper nº 5 destacável – branco','Cond.','Modelagem'),
      L ('MAC-014','Número de provas previstas',['1 prova','2 provas','3 provas'],'1 prova','N','Modelagem'),
    ]},
    tecido('6. TECIDO – MACACÃO','MAC',15,
      ['Brim','Gabardine','Tactel','Oxford','Ripstop','Microfibra','Malha dry','SMS / TNT (descartável)','Outro'],
      'Microfibra',
      ['100% poliéster','Poliéster + algodão','Poliéster + viscose','Poliéster + elastano','100% algodão','Polipropileno (TNT)','Outra'],
      '100% poliéster','145',
      [ id => L(id,'Exige Certificado de Aprovação (CA) como EPI',['Não','Sim – informar nº do CA'],'Não','S','Qualidade'),
        id => T(id,'Nº do CA / norma aplicável','NBR 16603 / CA 00000','Cond.','Qualidade') ]),
    [
      {cod:'A',ponto:'Largura do tórax',comoMedir:'2,5 cm abaixo da cava, fechado (meia medida)',tol:1},
      {cod:'B',ponto:'Largura da cintura',comoMedir:'Na linha da cintura, fechado (meia medida)',tol:1},
      {cod:'C',ponto:'Quadril',comoMedir:'18 cm abaixo da cintura, lado a lado (meia medida)',tol:1},
      {cod:'D',ponto:'Ombro a ombro',comoMedir:'De costura a costura do ombro',tol:0.5},
      {cod:'E',ponto:'Comprimento total',comoMedir:'Do ponto mais alto do ombro (HPS) até a barra da perna',tol:1.5},
      {cod:'F',ponto:'Comprimento das costas até a cintura',comoMedir:'Do pé de gola (centro costas) até a linha da cintura',tol:1},
      {cod:'G',ponto:'Comprimento da manga',comoMedir:'Da costura do ombro até a boca da manga',tol:0.5},
      {cod:'H',ponto:'Boca da manga',comoMedir:'Lado a lado (meia medida)',tol:0.3},
      {cod:'I',ponto:'Cava',comoMedir:'Em linha reta, do ombro até a axila (meia medida)',tol:0.5},
      {cod:'J',ponto:'Gancho / entrepernas',comoMedir:'Do entrepernas até a barra, pela costura interna',tol:1},
      {cod:'K',ponto:'Coxa',comoMedir:'2,5 cm abaixo do entrepernas (meia medida)',tol:0.5},
      {cod:'L',ponto:'Boca da perna',comoMedir:'Lado a lado na barra (meia medida)',tol:0.5},
    ]);

  /* ------------------------------------------------------------ COLETE */
  registrar('COLETE',
    { sec:'5. MODELO – COLETE', campos:[
      L ('COL-001','Tipo de colete',['Social (alfaiataria)','Operacional (trabalho)','Refletivo (segurança)','Acolchoado (térmico)','Multibolsos / pesca'],'Operacional (trabalho)'),
      L ('COL-002','Modelagem',['Unissex','Masculino tradicional','Masculino slim','Feminino acinturado'],'Unissex'),
      L ('COL-003','Fechamento',['Zíper frontal','Botões','Botões de pressão','Velcro','Aberto (sem fechamento)'],'Zíper frontal'),
      L ('COL-004','Gola',['Sem gola (decote V)','Gola alta (padre)','Gola esporte','Capuz removível'],'Gola alta (padre)'),
      L ('COL-005','Forro',['Forro total','Meio forro','Sem forro'],'Sem forro'),
      T ('COL-006','Tecido e cor do forro','Acetato / poliéster – preto','Cond.','Compras'),
      L ('COL-007','Bolsos externos',['Sem bolso','2 inferiores (faca)','2 inferiores + 1 no peito','Multibolsos (4 ou mais)','Chapados com lapela'],'2 inferiores + 1 no peito'),
      NU('COL-008','Bolsos internos (quantidade)','un','1','N','Comercial'),
      L ('COL-009','Ajuste lateral',['Sem ajuste','Elástico','Fivela regulável','Cordão','Velcro'],'Fivela regulável','S','Modelagem'),
      L ('COL-010','Faixa refletiva',['Não','1 faixa no peito','Faixa no peito e nas costas','X nas costas','Conforme NBR 15292'],'Faixa no peito e nas costas'),
      L ('COL-011','Acabamento da cava e do decote',['Viés do próprio tecido','Ribana','Debrum contrastante','Barra virada'],'Viés do próprio tecido','S','Modelagem'),
      T ('COL-012','Zíper / botões (material, tamanho, cor)','Zíper nº 5 destacável – preto','S','Modelagem'),
      L ('COL-013','Enchimento (só colete acolchoado)',['Sem enchimento','Manta acrílica 100 g','Manta acrílica 150 g','Pluma / penas'],'Sem enchimento','Cond.','Compras'),
      L ('COL-014','Número de provas previstas',['1 prova','2 provas','3 provas'],'1 prova','N','Modelagem'),
    ]},
    tecido('6. TECIDO – COLETE','COL',15,
      ['Tactel','Oxford','Brim','Gabardine','Tropical / poliviscose','Malha dry','Nylon acolchoado','Soft shell','Outro'],
      'Oxford',
      ['100% poliéster','Poliéster + algodão','Poliéster + viscose','Poliéster + viscose + elastano','100% nylon','Outra'],
      '100% poliéster','160'),
    [
      {cod:'A',ponto:'Largura do tórax',comoMedir:'2,5 cm abaixo da cava, fechado (meia medida)',tol:1},
      {cod:'B',ponto:'Largura da cintura',comoMedir:'Na parte mais estreita, fechado (meia medida)',tol:1},
      {cod:'C',ponto:'Largura da barra',comoMedir:'Lado a lado na barra (meia medida)',tol:1},
      {cod:'D',ponto:'Ombro a ombro',comoMedir:'De costura a costura do ombro',tol:0.5},
      {cod:'E',ponto:'Largura das costas',comoMedir:'De cava a cava, 15 cm abaixo do pé de gola',tol:0.5},
      {cod:'F',ponto:'Comprimento frente',comoMedir:'Do ponto mais alto do ombro (HPS) até a barra',tol:1},
      {cod:'G',ponto:'Comprimento costas',comoMedir:'Do pé de gola (centro costas) até a barra',tol:1},
      {cod:'H',ponto:'Cava',comoMedir:'Em linha reta, do ombro até a axila (meia medida)',tol:0.5},
      {cod:'I',ponto:'Abertura do decote',comoMedir:'De costura a costura do ombro, na borda interna',tol:0.5},
      {cod:'J',ponto:'Profundidade do decote',comoMedir:'Da linha HPS até o fim do decote, na frente',tol:0.5},
    ]);

  /* ----------------------------------------------------------- JAQUETA */
  registrar('JAQUETA',
    { sec:'5. MODELO – JAQUETA', campos:[
      L ('JAQ-001','Tipo de jaqueta',['Corta-vento','Acolchoada (nylon)','Moletom com zíper','Soft shell','Sarja / jeans','Bomber'],'Corta-vento'),
      L ('JAQ-002','Modelagem',['Unissex','Masculina','Feminina'],'Unissex'),
      L ('JAQ-003','Fechamento',['Zíper destacável','Zíper simples','Zíper + pala com botões de pressão','Botões de pressão','Botões comuns'],'Zíper destacável'),
      L ('JAQ-004','Gola',['Gola alta (padre)','Gola esporte','Gola ribana (bomber)','Capuz fixo','Capuz removível','Capuz embutido na gola'],'Gola alta (padre)'),
      L ('JAQ-005','Punho',['Ribana','Elástico','Com velcro de ajuste','Reto'],'Ribana','S','Modelagem'),
      L ('JAQ-006','Barra',['Ribana','Elástico','Elástico com cordão','Reta com ajuste lateral','Reta'],'Ribana','S','Modelagem'),
      L ('JAQ-007','Bolsos externos',['Sem bolso','2 embutidos na lateral','2 com zíper','2 chapados com lapela','2 canguru'],'2 com zíper'),
      NU('JAQ-008','Bolsos internos (quantidade)','un','1','N','Comercial'),
      L ('JAQ-009','Forro',['Forro total','Forro só no corpo','Forro acolchoado (matelassê)','Forro em malha','Sem forro'],'Forro total'),
      T ('JAQ-010','Tecido e cor do forro','Nylon / poliéster – preto','Cond.','Compras'),
      L ('JAQ-011','Enchimento',['Sem enchimento','Manta acrílica 100 g','Manta acrílica 150 g','Manta acrílica 200 g','Pluma / penas'],'Sem enchimento','Cond.','Compras'),
      L ('JAQ-012','Faixa refletiva',['Não','Peito e costas','Peito, costas e mangas','Conforme NBR 15292'],'Não'),
      T ('JAQ-013','Zíper (marca, tipo, nº, cor)','Zíper nº 5 destacável – preto','S','Modelagem'),
      L ('JAQ-014','Tipo de manga',['Manga montada','Manga raglan','Manga com recorte / vista'],'Manga montada','S','Modelagem'),
      L ('JAQ-015','Número de provas previstas',['1 prova','2 provas','3 provas'],'1 prova','N','Modelagem'),
    ]},
    tecido('6. TECIDO – JAQUETA','JAQ',16,
      ['Nylon / taslan','Tactel','Soft shell','Moletom flanelado','Sarja','Ripstop','Oxford','Microfibra','Outro'],
      'Nylon / taslan',
      ['100% poliéster','100% nylon','Poliéster + algodão','Poliéster + elastano','Poliéster + viscose','Outra'],
      '100% poliéster','120',
      [ id => L(id,'Impermeabilidade',['Não aplicável','Repelente (resiste a respingos)','Impermeável com coluna d’água','Membrana laminada'],'Repelente (resiste a respingos)','N','Compras') ]),
    [
      {cod:'A',ponto:'Largura do tórax',comoMedir:'2,5 cm abaixo da cava, fechado (meia medida)',tol:1},
      {cod:'B',ponto:'Largura da cintura',comoMedir:'Na parte mais estreita, fechado (meia medida)',tol:1},
      {cod:'C',ponto:'Largura da barra',comoMedir:'Lado a lado na barra, sem esticar a ribana (meia medida)',tol:1},
      {cod:'D',ponto:'Ombro a ombro',comoMedir:'De costura a costura do ombro (não se aplica a manga raglan)',tol:0.5},
      {cod:'E',ponto:'Largura das costas',comoMedir:'De cava a cava, 15 cm abaixo do pé de gola',tol:0.5},
      {cod:'F',ponto:'Comprimento costas',comoMedir:'Do pé de gola (centro costas) até a barra',tol:1},
      {cod:'G',ponto:'Comprimento da manga',comoMedir:'Da costura do ombro até a boca da manga (raglan: do pé de gola)',tol:0.5},
      {cod:'H',ponto:'Boca da manga / punho',comoMedir:'Lado a lado, sem esticar a ribana (meia medida)',tol:0.3},
      {cod:'I',ponto:'Cava',comoMedir:'Em linha reta, do ombro até a axila (meia medida)',tol:0.5},
      {cod:'J',ponto:'Altura da gola',comoMedir:'Da costura do pescoço até a borda superior',tol:0.3},
      {cod:'K',ponto:'Altura do capuz',comoMedir:'Da costura do pescoço até o topo do capuz',tol:0.5},
      {cod:'L',ponto:'Largura do capuz',comoMedir:'No ponto mais largo, achatado',tol:0.5},
    ]);

  /* ----------------------------------------------------------- AVENTAL */
  registrar('AVENTAL',
    { sec:'5. MODELO – AVENTAL', campos:[
      L ('AVE-001','Tipo de avental',['Hospitalar / paramentação','Cozinha / gastronomia','Industrial (açougue, química)','Impermeável','Social / atendimento (garçom)','Descartável'],'Hospitalar / paramentação'),
      L ('AVE-002','Formato',['Peitoral (corpo inteiro)','Cintura (meio avental / sommelier)','Capote (manga longa, abre nas costas)','Japona','Bistrô'],'Peitoral (corpo inteiro)'),
      L ('AVE-003','Manga',['Sem manga','Manga longa com punho','Manga longa sem punho','Manga curta'],'Sem manga'),
      L ('AVE-004','Fechamento',['Tiras para amarrar nas costas','Tira no pescoço + tiras na cintura','Botões de pressão nas costas','Velcro','Zíper','Transpassado'],'Tira no pescoço + tiras na cintura'),
      L ('AVE-005','Ajuste do pescoço',['Tira fixa','Tira regulável com fivela','Tira regulável com ilhós','Passante nos ombros','Não se aplica'],'Tira regulável com fivela','S','Modelagem'),
      L ('AVE-006','Punho',['Não se aplica','Ribana','Elástico','Com velcro de ajuste','Reto'],'Não se aplica','S','Modelagem'),
      L ('AVE-007','Bolsos',['Sem bolso','1 bolso central','1 bolso central dividido','2 bolsos frontais','Bolso no peito','Canguru'],'1 bolso central dividido'),
      L ('AVE-008','Abertura nas costas',['Fechado (veste pela cabeça)','Abertura total nas costas','Transpassado'],'Fechado (veste pela cabeça)','S','Modelagem'),
      L ('AVE-009','Acabamento das bordas',['Bainha do próprio tecido','Viés contrastante','Debrum','Overloque'],'Bainha do próprio tecido','S','Modelagem'),
      L ('AVE-010','Barra',['Reta com bainha','Arredondada','Com debrum','Com cordão'],'Reta com bainha','S','Modelagem'),
      L ('AVE-011','Reforço (travete) nas tiras e bolsos',['Sim','Não'],'Sim','S','Modelagem'),
      T ('AVE-012','Tiras (largura, comprimento e material)','Tira do próprio tecido – 4 cm × 90 cm','S','Modelagem'),
      L ('AVE-013','Proteção / impermeabilidade',['Nenhuma','Repelente (resiste a respingos)','Frente impermeável','Totalmente impermeável','Resistente a respingos químicos'],'Nenhuma'),
      L ('AVE-014','Faixa refletiva',['Não','1 faixa no peito','Peito e barra','Conforme NBR 15292'],'Não'),
      L ('AVE-015','Número de provas previstas',['1 prova','2 provas','3 provas'],'1 prova','N','Modelagem'),
    ]},
    tecido('6. TECIDO – AVENTAL','AVE',16,
      ['Brim','Oxford','Gabardine','Sarja','Tricoline','Microfibra','Napa / PVC emborrachado','Nylon','SMS / TNT (descartável)','Outro'],
      'Oxford',
      ['100% poliéster','Poliéster + algodão','Poliéster + viscose','100% algodão','PVC + poliéster','Polipropileno (TNT)','Outra'],
      '100% poliéster','160',
      [ id => L(id,'Exige Certificado de Aprovação (CA) como EPI',['Não','Sim – informar nº do CA'],'Não','S','Qualidade'),
        id => T(id,'Nº do CA / norma aplicável','NBR 16603 / CA 00000','Cond.','Qualidade') ]),
    [
      {cod:'A',ponto:'Largura do peitoral',comoMedir:'No topo do peitoral, lado a lado',tol:0.5},
      {cod:'B',ponto:'Largura na cintura',comoMedir:'Na altura das tiras da cintura, lado a lado',tol:1},
      {cod:'C',ponto:'Largura da barra',comoMedir:'Lado a lado na barra',tol:1},
      {cod:'D',ponto:'Comprimento total',comoMedir:'Do topo do peitoral até a barra (meio avental: do cós até a barra)',tol:1},
      {cod:'E',ponto:'Altura do peitoral',comoMedir:'Do topo do peitoral até a linha da cintura',tol:0.5},
      {cod:'F',ponto:'Comprimento da tira do pescoço',comoMedir:'De ponta a ponta, esticada sem forçar',tol:1},
      {cod:'G',ponto:'Comprimento das tiras da cintura',comoMedir:'Da lateral até a ponta, cada lado',tol:1.5},
      {cod:'H',ponto:'Largura das tiras',comoMedir:'Largura acabada',tol:0.2},
      {cod:'I',ponto:'Altura do bolso',comoMedir:'Da linha da cintura até a borda superior do bolso',tol:0.5},
      {cod:'J',ponto:'Largura do bolso',comoMedir:'Lado a lado, acabado',tol:0.5},
      {cod:'K',ponto:'Profundidade do bolso',comoMedir:'Da borda superior até o fundo',tol:0.5},
      {cod:'L',ponto:'Comprimento da manga',comoMedir:'Da costura do ombro até a boca da manga (se houver manga)',tol:0.5},
    ]);
})();
