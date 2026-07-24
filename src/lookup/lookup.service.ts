import { BadRequestException, Injectable } from '@nestjs/common';

/**
 * Consulta pública de CNPJ (BrasilAPI) e CEP (BrasilAPI + fallback ViaCEP).
 * Proxy no backend porque o CSP do frontend bloqueia chamadas externas.
 */
@Injectable()
export class LookupService {
  private readonly UA = { 'User-Agent': 'Mozilla/5.0 (CherkesianERP; +https://cherkesian-erp-backend.onrender.com)' };

  async cnpj(raw: string) {
    const cnpj = String(raw ?? '').replace(/\D/g, '');
    if (cnpj.length !== 14) throw new BadRequestException('CNPJ inválido (14 dígitos).');
    // BrasilAPI e minhareceita.org usam os MESMOS nomes de campo (dados da Receita).
    // De IPs de nuvem o BrasilAPI (CNPJ) às vezes limita; minhareceita é o fallback.
    const fontes = [
      `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`,
      `https://minhareceita.org/${cnpj}`,
    ];
    let d: Record<string, unknown> | null = null;
    for (const url of fontes) {
      const r = await fetch(url, { headers: this.UA }).catch(() => null);
      if (r && r.ok) { d = (await r.json().catch(() => null)) as Record<string, unknown> | null; if (d && (d.razao_social || d.nome)) break; d = null; }
    }
    if (!d) throw new BadRequestException('CNPJ não encontrado na base pública da Receita (ou serviço indisponível). Preencha manualmente.');
    const s = (k: string) => (d![k] == null ? '' : String(d![k]));
    return {
      cnpj,
      razaoSocial: s('razao_social') || s('nome'),
      nomeFantasia: s('nome_fantasia'),
      logradouro: [s('descricao_tipo_de_logradouro'), s('logradouro')].filter(Boolean).join(' ').trim(),
      numero: s('numero'),
      complemento: s('complemento'),
      bairro: s('bairro'),
      municipio: s('municipio'),
      uf: s('uf'),
      cep: s('cep').replace(/\D/g, ''),
      telefone: s('ddd_telefone_1').replace(/\D/g, ''),
      email: s('email').toLowerCase(),
      situacao: s('descricao_situacao_cadastral'),
    };
  }

  async cep(raw: string) {
    const cep = String(raw ?? '').replace(/\D/g, '');
    if (cep.length !== 8) throw new BadRequestException('CEP inválido (8 dígitos).');
    // BrasilAPI (v2) primeiro; se falhar, ViaCEP.
    const b = await fetch(`https://brasilapi.com.br/api/cep/v2/${cep}`, { headers: this.UA }).catch(() => null);
    if (b && b.ok) {
      const d = (await b.json().catch(() => ({}))) as Record<string, unknown>;
      return { cep, logradouro: String(d.street ?? ''), bairro: String(d.neighborhood ?? ''), municipio: String(d.city ?? ''), uf: String(d.state ?? '') };
    }
    const v = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { headers: this.UA }).catch(() => null);
    if (!v || !v.ok) throw new BadRequestException('CEP não encontrado.');
    const d = (await v.json().catch(() => ({}))) as Record<string, unknown>;
    if (d.erro) throw new BadRequestException('CEP não encontrado.');
    return { cep, logradouro: String(d.logradouro ?? ''), bairro: String(d.bairro ?? ''), municipio: String(d.localidade ?? ''), uf: String(d.uf ?? '') };
  }
}
