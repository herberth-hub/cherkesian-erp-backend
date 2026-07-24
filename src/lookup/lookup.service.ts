import { BadRequestException, Injectable } from '@nestjs/common';

/**
 * Consulta pública de CNPJ (BrasilAPI) e CEP (BrasilAPI + fallback ViaCEP).
 * Proxy no backend porque o CSP do frontend bloqueia chamadas externas.
 */
@Injectable()
export class LookupService {
  async cnpj(raw: string) {
    const cnpj = String(raw ?? '').replace(/\D/g, '');
    if (cnpj.length !== 14) throw new BadRequestException('CNPJ inválido (14 dígitos).');
    const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`).catch(() => null);
    if (!r || !r.ok) throw new BadRequestException('CNPJ não encontrado na base pública da Receita.');
    const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    const s = (k: string) => (d[k] == null ? '' : String(d[k]));
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
    const b = await fetch(`https://brasilapi.com.br/api/cep/v2/${cep}`).catch(() => null);
    if (b && b.ok) {
      const d = (await b.json().catch(() => ({}))) as Record<string, unknown>;
      return { cep, logradouro: String(d.street ?? ''), bairro: String(d.neighborhood ?? ''), municipio: String(d.city ?? ''), uf: String(d.state ?? '') };
    }
    const v = await fetch(`https://viacep.com.br/ws/${cep}/json/`).catch(() => null);
    if (!v || !v.ok) throw new BadRequestException('CEP não encontrado.');
    const d = (await v.json().catch(() => ({}))) as Record<string, unknown>;
    if (d.erro) throw new BadRequestException('CEP não encontrado.');
    return { cep, logradouro: String(d.logradouro ?? ''), bairro: String(d.bairro ?? ''), municipio: String(d.localidade ?? ''), uf: String(d.uf ?? '') };
  }
}
