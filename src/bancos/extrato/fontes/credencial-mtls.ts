/**
 * CREDENCIAL DE API DE BANCO — o pedaço que é igual em todo banco.
 *
 * Cora, Santander e Bradesco pedem a mesma coisa na conexão: um certificado e
 * uma chave privada em PEM, apresentados no TLS (mutual TLS). O que muda entre
 * eles é o nome da variável, a URL e se há client secret — não a forma do PEM
 * nem os jeitos de ele chegar quebrado.
 *
 * Isto aqui nasceu dentro do `cora.fonte.ts` e saiu de lá quando o Santander
 * entrou: duas fontes copiando a mesma conferência de PEM seria a segunda
 * delas ficando para trás na primeira correção.
 */
import { X509Certificate } from 'crypto';

/**
 * PEM saindo de uma variável de ambiente, em qualquer das formas que ele chega.
 *
 * 1. `\n` literal, porque campo de uma linha não aceita quebra de verdade;
 * 2. BASE64 do arquivo inteiro — a forma à prova de tudo.
 *
 * A (2) existe por um motivo medido: o campo do Render REMOVE as linhas
 * `-----BEGIN ...-----` e `-----END ...-----` do valor. O certificado da
 * Yerevan entrou com 2088 caracteres e ficou guardado com 2036 — exatamente os
 * 52 das duas linhas. Sem elas o OpenSSL não carrega nada, e não há como pedir
 * ao Render que pare de fazer isso. Base64 não tem traço, nem quebra de linha,
 * nem aspas: passa ileso por qualquer campo.
 */
export function normalizarPem(texto: string | undefined | null): string {
  const bruto = String(texto ?? '').replace(/\\r/g, '').replace(/\\n/g, '\n').trim();
  if (!bruto || bruto.includes('-----BEGIN')) return bruto;
  // Sem cabeçalho: pode ser o arquivo inteiro em base64. Só tenta quando o
  // texto é mesmo base64 — senão devolve como veio, para a conferência de PEM
  // explicar o que está errado.
  const limpo = bruto.replace(/\s+/g, '');
  if (limpo.length < 64 || !/^[A-Za-z0-9+/=]+$/.test(limpo)) return bruto;
  try {
    const decodificado = Buffer.from(limpo, 'base64').toString('utf8');
    if (decodificado.includes('-----BEGIN')) return decodificado.trim();
  } catch { /* não era base64 — segue com o texto original */ }
  return bruto;
}

/**
 * O PEM CHEGOU INTEIRO?
 *
 * Colar um certificado num campo de formulário é onde tudo quebra: falta a
 * linha BEGIN, o editor corta o fim, o valor vem com aspas em volta. O TLS
 * reclama disso com "error:0909006C:PEM routines:get_name:no start line", que
 * não ajuda ninguém. Aqui a conferência é feita antes, em português.
 */
export function conferirPem(texto: string, tipo: 'certificado' | 'chave'): string | null {
  const t = normalizarPem(texto);
  if (!t) return `${tipo}: está vazio`;
  if (/^["'].*["']$/s.test(t)) return `${tipo}: veio com aspas em volta — cole o conteúdo sem aspas`;
  const temInicio = /-----BEGIN [A-Z ]+-----/.test(t);
  const temFim = /-----END [A-Z ]+-----/.test(t);
  if (!temInicio && temFim) {
    return `${tipo}: só a linha "-----END-----" sobrou — o campo guardou uma linha só. `
      + 'Use o valor em BASE64 (o arquivo .b64.txt que o sistema gera)';
  }
  // O caso medido no Render: ele APAGA as linhas com "-----" do valor, e sobra
  // só o miolo em base64 do PEM. Quem lê a mensagem precisa saber que não
  // adianta colar o PEM de novo — tem de ser o base64 do arquivo.
  if (!temInicio && /^[A-Za-z0-9+/=\s\\n]+$/.test(t) && t.replace(/\s+/g, '').length > 200) {
    return `${tipo}: chegou só o miolo, sem as linhas "-----BEGIN-----" e "-----END-----". `
      + 'O campo do Render apaga linhas com traços — cole o valor em BASE64 (arquivo .b64.txt)';
  }
  if (!temInicio) return `${tipo}: falta a linha "-----BEGIN ...-----" no começo`;
  if (!temFim) return `${tipo}: falta a linha "-----END ...-----" no fim (o valor foi cortado?)`;
  if (!t.includes('\n')) return `${tipo}: veio numa linha só, sem quebras de linha — cole o arquivo inteiro`;
  if (tipo === 'chave' && /BEGIN CERTIFICATE/.test(t)) return 'chave: isso é o CERTIFICADO, não a chave privada — os dois valores estão trocados';
  if (tipo === 'certificado' && /BEGIN [A-Z ]*PRIVATE KEY/.test(t)) return 'certificado: isso é a CHAVE PRIVADA, não o certificado — os dois valores estão trocados';
  return null;
}

/**
 * ATÉ QUANDO A CREDENCIAL VALE.
 *
 * O Cora emite por 1 ano e desativa sozinho — a integração pararia de puxar
 * extrato num dia qualquer, com um 401 que ninguém saberia interpretar. O
 * Santander exige A1 (ICP-Brasil), que vale 1 ano também. A data não precisa
 * ser cadastrada em lugar nenhum: ela está DENTRO do certificado. Lendo de lá,
 * não há o que o Herberth esquecer de preencher.
 */
export interface ValidadeCertificado {
  vence: Date;
  diasRestantes: number;
  /** Menos de 30 dias — hora de pedir a nova credencial. */
  perto: boolean;
  vencido: boolean;
}

export function validadeDoCertificado(certPem: string, hoje: Date = new Date()): ValidadeCertificado | null {
  try {
    const x = new X509Certificate(certPem);
    const vence = new Date(x.validTo);
    if (Number.isNaN(vence.getTime())) return null;
    const dias = Math.floor((vence.getTime() - hoje.getTime()) / 86_400_000);
    return { vence, diasRestantes: dias, perto: dias <= 30, vencido: dias < 0 };
  } catch {
    return null; // certificado ilegível: quem reclama é o TLS, com mensagem própria
  }
}

/**
 * O certificado tem a CADEIA COMPLETA?
 *
 * O Santander exige o PEM com raiz + intermediário + folha. Mandar só a folha
 * conecta em alguns servidores e falha em outros, com erro de TLS que não diz
 * o que falta. Um PEM de cadeia tem mais de um bloco CERTIFICATE.
 */
export function blocosDoCertificado(certPem: string): number {
  return (normalizarPem(certPem).match(/-----BEGIN CERTIFICATE-----/g) ?? []).length;
}
