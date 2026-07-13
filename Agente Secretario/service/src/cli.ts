import { runAgente } from './agente';
import { INSTRUCAO_BRIEFING } from './prompt';
import { cfg } from './config';
import { listarPendentes, obter, atualizar } from './approvals';
import { enviarEmail, criarEvento } from './google';

/**
 * CLI do Agente Secretário (Fases 1–2).
 *   npm run briefing                  → briefing da manhã
 *   npm run agente -- "sua pergunta"  → pergunta/tarefa (leitura + redação)
 *   npm run aprovacoes                → lista as propostas pendentes
 *   npm run aprovar -- <id>           → aprova e EXECUTA (envia e-mail / cria evento)
 *   npm run recusar -- <id>           → recusa a proposta
 */
async function main() {
  const args = process.argv.slice(2);
  const cmd = (args[0] || '').toLowerCase();

  if (cmd === 'aprovacoes') return listar();
  if (cmd === 'aprovar') return decidir(args[1], true);
  if (cmd === 'recusar') return decidir(args[1], false);

  // Caso contrário: roda o agente (briefing ou pergunta livre).
  const instrucao =
    cmd === 'briefing'
      ? INSTRUCAO_BRIEFING
      : args.join(' ').trim() ||
        'Resuma a situação atual do ERP (dashboard) e o que precisa de atenção hoje.';

  console.log(`\n🤖 Agente Secretário Cherkesian — Fase 2 (leitura + redação c/ aprovação)`);
  console.log(`   modelo: ${cfg.model} · ERP: ${cfg.erpBaseUrl}\n`);
  console.log(`📋 Tarefa: ${cmd === 'briefing' ? 'Briefing da manhã' : instrucao}\n`);

  const r = await runAgente(instrucao, (msg) => console.log('   ' + msg));
  console.log('\n──────────────────────────────────────────\n');
  console.log(r.resposta);
  console.log('\n──────────────────────────────────────────');
  console.log(`(ferramentas usadas: ${r.ferramentas_usadas.join(', ') || 'nenhuma'})`);
  const pend = listarPendentes();
  if (pend.length) {
    console.log(`\n⏳ ${pend.length} proposta(s) pendente(s) de aprovação. Rode: npm run aprovacoes\n`);
  } else {
    console.log('');
  }
}

function listar() {
  const pend = listarPendentes();
  if (!pend.length) {
    console.log('\n✅ Nenhuma proposta pendente.\n');
    return;
  }
  console.log(`\n⏳ ${pend.length} proposta(s) pendente(s):\n`);
  for (const a of pend) {
    console.log(`  [${a.id}] ${a.tipo.toUpperCase()} · ${a.resumo}`);
    if (a.tipo === 'email') {
      console.log(`      Para: ${a.dados.para}`);
      console.log(`      Assunto: ${a.dados.assunto}`);
      console.log(`      ---\n${indent(String(a.dados.corpo || ''), '      ')}\n      ---`);
    } else {
      console.log(`      Quando: ${a.dados.quando} (${a.dados.duracao_min} min)`);
      console.log(`      Convidados: ${(a.dados.convidados as string[])?.join(', ') || '—'}`);
      if (a.dados.descricao) console.log(`      Descrição: ${a.dados.descricao}`);
    }
    console.log('');
  }
  console.log('Aprovar:  npm run aprovar -- <id>');
  console.log('Recusar:  npm run recusar -- <id>\n');
}

async function decidir(id: string | undefined, aprovar: boolean) {
  if (!id) {
    console.error('\n❌ Informe o id. Ex.: npm run aprovar -- ema-a1b2c3\n');
    process.exit(1);
  }
  const a = obter(id);
  if (!a) {
    console.error(`\n❌ Proposta "${id}" não encontrada.\n`);
    process.exit(1);
  }
  if (a.status !== 'pendente') {
    console.error(`\n❌ Proposta "${id}" já está "${a.status}".\n`);
    process.exit(1);
  }

  if (!aprovar) {
    atualizar(id, { status: 'recusada', decididoEm: new Date().toISOString() });
    console.log(`\n🚫 Proposta ${id} recusada. Nada foi enviado.\n`);
    return;
  }

  try {
    let resultado: string;
    if (a.tipo === 'email') {
      const de = `Grupo Cherkesian <${cfg.diretor.email}>`;
      const r = await enviarEmail(String(a.dados.para), String(a.dados.assunto), String(a.dados.corpo), de);
      resultado = `E-mail enviado (id ${r.id}).`;
    } else {
      const r = await criarEvento(
        String(a.dados.titulo),
        String(a.dados.quando),
        Number(a.dados.duracao_min ?? 30),
        (a.dados.convidados as string[]) || [],
        a.dados.descricao ? String(a.dados.descricao) : undefined,
        cfg.timezone,
      );
      resultado = `Evento criado: ${r.link}`;
    }
    atualizar(id, { status: 'aprovada', decididoEm: new Date().toISOString(), resultado });
    console.log(`\n✅ Aprovado e executado. ${resultado}\n`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    atualizar(id, { status: 'erro', decididoEm: new Date().toISOString(), resultado: msg });
    console.error(`\n❌ Falha ao executar a proposta ${id}: ${msg}\n`);
    process.exit(1);
  }
}

function indent(txt: string, pad: string): string {
  return txt.split('\n').map((l) => pad + l).join('\n');
}

main().catch((e) => {
  console.error('\n❌ ' + (e instanceof Error ? e.message : String(e)) + '\n');
  process.exit(1);
});
