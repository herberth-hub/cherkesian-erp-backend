import { runAgente } from './agente';
import { INSTRUCAO_BRIEFING } from './prompt';
import { cfg } from './config';

/**
 * CLI do Agente Secretário (Fase 1).
 *   npm run briefing                  → briefing da manhã
 *   npm run agente -- "sua pergunta"  → pergunta livre (leitura)
 */
async function main() {
  const args = process.argv.slice(2);
  const primeiro = (args[0] || '').toLowerCase();
  const instrucao =
    primeiro === 'briefing'
      ? INSTRUCAO_BRIEFING
      : args.join(' ').trim() ||
        'Faça um resumo rápido da situação atual do ERP (dashboard) e o que precisa de atenção hoje.';

  console.log(`\n🤖 Agente Secretário Cherkesian — Fase 1 (leitura)`);
  console.log(`   modelo: ${cfg.model} · ERP: ${cfg.erpBaseUrl}\n`);
  console.log(`📋 Tarefa: ${primeiro === 'briefing' ? 'Briefing da manhã' : instrucao}\n`);

  try {
    const r = await runAgente(instrucao, (msg) => console.log('   ' + msg));
    console.log('\n──────────────────────────────────────────\n');
    console.log(r.resposta);
    console.log('\n──────────────────────────────────────────');
    console.log(`(ferramentas usadas: ${r.ferramentas_usadas.join(', ') || 'nenhuma'})\n`);
  } catch (e) {
    console.error('\n❌ ' + (e instanceof Error ? e.message : String(e)) + '\n');
    process.exit(1);
  }
}

main();
