'use strict';

/** Erro de regra de negócio: mensagem em português, código estável para testes. */
class ErroNegocio extends Error {
  constructor(codigo, mensagem, detalhes) {
    super(mensagem);
    this.name = 'ErroNegocio';
    this.codigo = codigo;
    if (detalhes !== undefined) this.detalhes = detalhes;
  }
}

module.exports = { ErroNegocio };
