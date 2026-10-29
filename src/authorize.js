// A única função que decide se uma chamada roda. Ela roda ANTES de qualquer
// validação ou corpo de ferramenta, e nega por padrão: só devolve ok:true se
// todas as regras abaixo passarem, nesta ordem.

const nega = (codigo, motivo) => ({ ok: false, codigo, motivo });

/**
 * @param agentes    conteúdo de agentes.json
 * @param agente     identidade vinda da variável de ambiente AGENTE
 * @param nome       nome da ferramenta pedida (texto cru do cliente)
 * @param ferramenta definição da ferramenta, ou undefined se o nome não existe
 * @param args       argumentos CRUS (ainda não validados): por isso obraDe é defensivo
 * @param dados      estado atual (pedidos etc.), para achar a obra de um pedido
 */
export function authorize({ agentes, agente, nome, ferramenta, args, dados }) {
  // Object.hasOwn: "constructor" ou "__proto__" não podem virar agente por herança.
  if (!Object.hasOwn(agentes, agente)) {
    return nega('AGENTE_DESCONHECIDO', `agente ${JSON.stringify(agente.slice(0, 40))} não existe em agentes.json`);
  }
  const cfg = agentes[agente];

  // Ferramenta inexistente e ferramenta não liberada dão a mesma resposta.
  if (!ferramenta || !cfg.ferramentas.includes(nome)) {
    // nome é texto cru do cliente: só os 80 primeiros caracteres entram na mensagem
    return nega('FERRAMENTA_NAO_PERMITIDA', `o agente "${agente}" não tem acesso à ferramenta "${nome.slice(0, 80)}"`);
  }
  if (ferramenta.escrita && cfg.escrita !== true) {
    return nega('ESCRITA_NAO_PERMITIDA', `o agente "${agente}" é somente leitura`);
  }
  if (ferramenta.papel && cfg.papel !== ferramenta.papel) {
    return nega('PAPEL_INSUFICIENTE', `"${nome}" exige o papel "${ferramenta.papel}"; o agente "${agente}" tem o papel "${cfg.papel}"`);
  }

  // obraDe devolve: string (a obra que a chamada toca), null (não é por obra)
  // ou undefined (não deu para saber). Dúvida = negar. A mesma mensagem vale
  // para "não existe" e "existe mas é de outro agente", para ninguém enumerar obras.
  const obra = ferramenta.obraDe(args, dados);
  if (obra === undefined || (obra !== null && !cfg.obras.includes(obra))) {
    return nega('OBRA_FORA_DO_ESCOPO', `obra ou recurso ausente, inexistente ou fora da lista de obras do agente "${agente}"`);
  }
  return { ok: true, cfg };
}

/** Confere agentes.json na subida. Config errada derruba o servidor (falha fechada). */
export function validaAgentes(agentes, ferramentas, obras) {
  const papeis = ['leitor', 'operador', 'gestor'];
  for (const [nome, c] of Object.entries(agentes)) {
    const erro = (msg) => { throw new Error(`agentes.json: agente "${nome}" ${msg}`); };
    if (!papeis.includes(c.papel)) erro(`tem papel inválido (${c.papel})`);
    if (typeof c.escrita !== 'boolean') erro('precisa de "escrita": true ou false');
    if (!Array.isArray(c.ferramentas)) erro('precisa de "ferramentas": [...]');
    if (!Array.isArray(c.obras)) erro('precisa de "obras": [...]');
    for (const f of c.ferramentas) if (!Object.hasOwn(ferramentas, f)) erro(`lista uma ferramenta que não existe: ${f}`);
    for (const o of c.obras) if (!obras.includes(o)) erro(`lista uma obra que não existe: ${o}`);
  }
}
