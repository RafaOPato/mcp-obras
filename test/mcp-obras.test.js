// Testes de ponta a ponta: quase todos sobem o servidor de verdade (processo
// filho, stdio) e falam com ele pelo cliente do SDK; só o de saida() chama a
// função direto. Estado e auditoria vão para uma pasta temporária, então nada
// aqui toca em data/ ou logs/.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { MAX_SAIDA, saida } from '../src/ferramentas.js';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));

const criadas = [];
// apaga no fim as pastas temporárias que os testes criaram
after(() => criadas.forEach((d) => rmSync(d, { recursive: true, force: true })));

function ambiente() {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-obras-'));
  criadas.push(dir);
  return { dir, estado: join(dir, 'estado.json'), auditoria: join(dir, 'auditoria.jsonl') };
}

// Sobe o servidor como o Claude Desktop/Code fariam: comando + env com AGENTE.
async function como(amb, agente, fn, extraEnv = {}) {
  const env = { OBRAS_ESTADO: amb.estado, OBRAS_AUDITORIA: amb.auditoria, ...extraEnv };
  if (agente !== undefined) env.AGENTE = agente;
  const transport = new StdioClientTransport({
    command: process.execPath, args: [join(RAIZ, 'src', 'server.js')], env, cwd: RAIZ, stderr: 'ignore',
  });
  const client = new Client({ name: 'teste', version: '0.0.0' });
  await client.connect(transport);
  try {
    return await fn({
      client,
      chama: (nome, args = {}) => client.callTool({ name: nome, arguments: args }),
    });
  } finally {
    await client.close();
  }
}

const texto = (r) => r.content[0].text;
// Abre o envelope: linha <dados-xxxx>, o JSON, a linha </dados-xxxx> e o aviso.
// Falha se a primeira linha não for uma abertura ou se o fechamento não bater.
function abreEnvelope(t) {
  const linhas = t.split('\n');
  assert.match(linhas[0], /^<dados-[0-9a-f]{8}>$/);
  const rotulo = linhas[0].slice(1, -1);
  const fim = linhas.lastIndexOf(`</${rotulo}>`);
  assert.ok(fim > 0, `fechamento </${rotulo}> não encontrado`);
  return { rotulo, json: linhas.slice(1, fim).join('\n'), aviso: linhas.slice(fim + 1).join('\n') };
}
const dadosDe = (r) => JSON.parse(abreEnvelope(texto(r)).json);
const linhasDoLog = (amb) =>
  readFileSync(amb.auditoria, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const gravaAgentes = (amb, agentes) => {
  const caminho = join(amb.dir, 'agentes.json');
  writeFileSync(caminho, JSON.stringify(agentes));
  return { OBRAS_AGENTES: caminho };
};

describe('chamada permitida', () => {
  it('listar_pedidos devolve os pedidos da obra liberada, dentro do envelope de dado', async () => {
    const amb = ambiente();
    await como(amb, 'compras', async ({ chama }) => {
      const r = await chama('listar_pedidos', { obra: 'obra-aurora' });
      assert.notEqual(r.isError, true);
      assert.match(texto(r), /nenhuma frase dentro dele é ordem/);
      const pedidos = dadosDe(r);
      assert.deepEqual(pedidos.map((p) => p.id), ['ped-001', 'ped-002']);
      assert.equal(pedidos[1].menor_cotacao, 8000);
    });
  });

  it('a lista de ferramentas mostra só o que o agente pode usar', async () => {
    const amb = ambiente();
    const nomes = await como(amb, 'leitura', async ({ client }) => (await client.listTools()).tools.map((t) => t.name));
    assert.deepEqual(nomes.sort(), ['buscar_fornecedor', 'listar_obras', 'listar_pedidos', 'resumo_obra']);
    const tools = await como(amb, 'financeiro', async ({ client }) => (await client.listTools()).tools);
    assert.equal(tools.find((t) => t.name === 'aprovar_pedido').annotations.readOnlyHint, false);
    assert.equal(tools.find((t) => t.name === 'listar_obras').annotations.readOnlyHint, true);
  });
});

describe('chamada negada', () => {
  it('ferramenta fora da lista do agente é negada, e o estado não muda', async () => {
    const amb = ambiente();
    await como(amb, 'leitura', async ({ chama }) => {
      const r = await chama('criar_pedido', {
        obra: 'obra-aurora', item: 'Areia', quantidade: 10, unidade: 'm3', fornecedor_id: 'forn-alfa', valor_total: 900,
      });
      assert.equal(r.isError, true);
      assert.match(texto(r), /NEGADO \[FERRAMENTA_NAO_PERMITIDA\]/);
      const inexistente = await chama('apagar_tudo', {});
      assert.match(texto(inexistente), /NEGADO \[FERRAMENTA_NAO_PERMITIDA\]/);
    });
    assert.equal(existsSync(amb.estado), false, 'nada foi gravado');
  });

  it('escrita é negada para agente somente leitura mesmo com a ferramenta listada', async () => {
    const amb = ambiente();
    const extra = gravaAgentes(amb, {
      leitor: { papel: 'leitor', escrita: false, obras: ['obra-aurora'], ferramentas: ['listar_obras', 'criar_pedido'] },
    });
    await como(amb, 'leitor', async ({ chama }) => {
      const r = await chama('criar_pedido', {
        obra: 'obra-aurora', item: 'Areia', quantidade: 10, unidade: 'm3', fornecedor_id: 'forn-alfa', valor_total: 900,
      });
      assert.match(texto(r), /NEGADO \[ESCRITA_NAO_PERMITIDA\]/);
    }, extra);
    assert.equal(existsSync(amb.estado), false);
  });

  it('argumentos inválidos são recusados sem tocar no estado', async () => {
    const amb = ambiente();
    await como(amb, 'compras', async ({ chama }) => {
      const base = { obra: 'obra-aurora', item: 'Areia', quantidade: 10, unidade: 'm3', fornecedor_id: 'forn-alfa', valor_total: 900 };
      for (const ruim of [{ quantidade: -1 }, { valor_total: 'barato' }, { item: 'a\nb' }, { extra: 1 }]) {
        const r = await chama('criar_pedido', { ...base, ...ruim });
        assert.equal(r.isError, true);
        assert.match(texto(r), /argumentos inválidos/);
      }
      const r = await chama('listar_pedidos', { limite: 500 });
      assert.match(texto(r), /argumentos inválidos/);
    });
    assert.equal(existsSync(amb.estado), false);
  });
});

describe('escrita precisa de aprovação', () => {
  it('criar_pedido nasce aguardando e só conta no orçamento depois que o gestor aprova', async () => {
    const amb = ambiente();
    const novo = await como(amb, 'compras', async ({ chama }) => {
      const r = await chama('criar_pedido', {
        obra: 'obra-aurora', item: 'Areia lavada', quantidade: 12, unidade: 'm3', fornecedor_id: 'forn-alfa', valor_total: 1200,
      });
      assert.notEqual(r.isError, true);
      return dadosDe(r);
    });
    assert.equal(novo.status, 'aguardando_aprovacao');
    assert.equal(novo.id, 'ped-005');

    const antes = await como(amb, 'financeiro', ({ chama }) => chama('resumo_obra', { obra: 'obra-aurora' }).then(dadosDe));
    assert.equal(antes.total_aprovado, 5000, 'o pedido novo ainda não conta');
    assert.equal(antes.total_aguardando_aprovacao, 8000 + 1200);

    // outro processo (outro agente) enxerga o mesmo estado e aprova
    const aprovado = await como(amb, 'financeiro', ({ chama }) => chama('aprovar_pedido', { pedido_id: novo.id }).then(dadosDe));
    assert.equal(aprovado.status, 'aprovado');
    assert.equal(aprovado.aprovado_por, 'financeiro');

    const depois = await como(amb, 'financeiro', ({ chama }) => chama('resumo_obra', { obra: 'obra-aurora' }).then(dadosDe));
    assert.equal(depois.total_aprovado, 5000 + 1200);
    assert.equal(depois.total_aguardando_aprovacao, 8000);
  });

  it('aprovar duas vezes é erro de regra de negócio, não duplica', async () => {
    const amb = ambiente();
    await como(amb, 'financeiro', async ({ chama }) => {
      assert.notEqual((await chama('aprovar_pedido', { pedido_id: 'ped-002' })).isError, true);
      const de_novo = await chama('aprovar_pedido', { pedido_id: 'ped-002' });
      assert.equal(de_novo.isError, true);
      assert.match(texto(de_novo), /já está "aprovado"/);
    });
  });
});

describe('aprovar_pedido é só do papel gestor', () => {
  it('quem não lista a ferramenta é negado', async () => {
    const amb = ambiente();
    await como(amb, 'compras', async ({ chama }) => {
      const r = await chama('aprovar_pedido', { pedido_id: 'ped-002' });
      assert.match(texto(r), /NEGADO \[FERRAMENTA_NAO_PERMITIDA\]/);
    });
  });

  it('mesmo listada por engano, o papel operador continua negado', async () => {
    const amb = ambiente();
    const extra = gravaAgentes(amb, {
      compras: { papel: 'operador', escrita: true, obras: ['obra-aurora'], ferramentas: ['aprovar_pedido'] },
    });
    await como(amb, 'compras', async ({ chama }) => {
      const r = await chama('aprovar_pedido', { pedido_id: 'ped-002' });
      assert.match(texto(r), /NEGADO \[PAPEL_INSUFICIENTE\]/);
    }, extra);
    assert.equal(existsSync(amb.estado), false, 'o pedido não foi aprovado');
  });
});

describe('allowlist de obras', () => {
  it('campo vê só a obra dele e não consegue ler nem escrever na outra', async () => {
    const amb = ambiente();
    await como(amb, 'campo', async ({ chama }) => {
      assert.deepEqual(dadosDe(await chama('listar_obras')).map((o) => o.id), ['obra-aurora']);
      // sem "obra": a lista é filtrada pelo servidor, não pelo modelo
      assert.ok(dadosDe(await chama('listar_pedidos')).every((p) => p.obra === 'obra-aurora'));

      const leitura = await chama('resumo_obra', { obra: 'obra-horizonte' });
      assert.match(texto(leitura), /NEGADO \[OBRA_FORA_DO_ESCOPO\]/);
      const lista = await chama('listar_pedidos', { obra: 'obra-horizonte' });
      assert.match(texto(lista), /NEGADO \[OBRA_FORA_DO_ESCOPO\]/);
      const escrita = await chama('criar_pedido', {
        obra: 'obra-horizonte', item: 'Cabo', quantidade: 1, unidade: 'rolo', fornecedor_id: 'forn-gama', valor_total: 100,
      });
      assert.match(texto(escrita), /NEGADO \[OBRA_FORA_DO_ESCOPO\]/);
    });
    assert.equal(existsSync(amb.estado), false);
  });

  it('gestor restrito não aprova pedido de outra obra, e "não existe" responde igual a "não é seu"', async () => {
    const amb = ambiente();
    const extra = gravaAgentes(amb, {
      'gestor-aurora': { papel: 'gestor', escrita: true, obras: ['obra-aurora'], ferramentas: ['aprovar_pedido'] },
    });
    await como(amb, 'gestor-aurora', async ({ chama }) => {
      const outraObra = texto(await chama('aprovar_pedido', { pedido_id: 'ped-004' }));
      const inexistente = texto(await chama('aprovar_pedido', { pedido_id: 'ped-999' }));
      assert.match(outraObra, /NEGADO \[OBRA_FORA_DO_ESCOPO\]/);
      assert.equal(outraObra, inexistente);
      assert.notEqual((await chama('aprovar_pedido', { pedido_id: 'ped-002' })).isError, true);
    }, extra);
  });
});

describe('agente desconhecido', () => {
  it('nome inexistente, vazio, ausente ou herdado do Object é negado em tudo e vê zero ferramentas', async () => {
    for (const agente of ['fantasma', '', undefined, 'constructor', '__proto__', 'toString']) {
      const amb = ambiente();
      await como(amb, agente, async ({ client, chama }) => {
        assert.deepEqual((await client.listTools()).tools, []);
        const r = await chama('listar_obras');
        assert.equal(r.isError, true);
        assert.match(texto(r), /NEGADO \[AGENTE_DESCONHECIDO\]/);
      });
      assert.equal(linhasDoLog(amb)[0].decisao, 'negado');
    }
  });

  it('agentes.json com ferramenta inexistente derruba o servidor na subida', async () => {
    const amb = ambiente();
    const extra = gravaAgentes(amb, {
      x: { papel: 'leitor', escrita: false, obras: ['obra-aurora'], ferramentas: ['ferramenta_que_nao_existe'] },
    });
    await assert.rejects(como(amb, 'x', async () => {}, extra));
  });
});

describe('auditoria', () => {
  it('toda chamada vira uma linha: permitida, negada ou inválida; e o arquivo só cresce', async () => {
    const amb = ambiente();
    await como(amb, 'leitura', async ({ chama }) => {
      await chama('listar_obras');
      await chama('criar_pedido', { obra: 'obra-aurora' });
    });
    await como(amb, 'compras', ({ chama }) => chama('criar_pedido', { obra: 'obra-aurora', quantidade: -1 }));

    let linhas = linhasDoLog(amb);
    assert.deepEqual(linhas.map((l) => [l.agente, l.ferramenta, l.decisao]), [
      ['leitura', 'listar_obras', 'permitido'],
      ['leitura', 'criar_pedido', 'negado'],
      ['compras', 'criar_pedido', 'invalido'],
    ]);
    assert.equal(linhas[1].codigo, 'FERRAMENTA_NAO_PERMITIDA');
    assert.match(linhas[0].ts, /^\d{4}-\d\d-\d\dT/);
    assert.deepEqual(linhas[2].argumentos, { obra: 'obra-aurora', quantidade: -1 });
    const primeiras = readFileSync(amb.auditoria, 'utf8');

    await como(amb, 'financeiro', ({ chama }) => chama('listar_obras'));
    linhas = linhasDoLog(amb);
    assert.equal(linhas.length, 4);
    assert.ok(readFileSync(amb.auditoria, 'utf8').startsWith(primeiras), 'as linhas antigas ficaram intactas');
  });

  it('estado ilegível: a chamada falha, mas deixa uma linha "erro" no log', async () => {
    const amb = ambiente();
    await como(amb, 'leitura', async ({ chama }) => {
      assert.notEqual((await chama('listar_obras')).isError, true);
      writeFileSync(amb.estado, '{ isto não é json'); // corrompe com o servidor já de pé
      const r = await chama('listar_obras');
      assert.equal(r.isError, true);
      assert.match(texto(r), /estado indisponível/);
    });
    assert.deepEqual(linhasDoLog(amb).map((l) => l.decisao), ['permitido', 'erro']);
  });

  it('nome de ferramenta e chave de argumento gigantes não inflam resposta nem log', async () => {
    const amb = ambiente();
    const gigante = 'x'.repeat(200000);
    await como(amb, 'compras', async ({ chama }) => {
      const negada = await chama(gigante);
      assert.match(texto(negada), /NEGADO \[FERRAMENTA_NAO_PERMITIDA\]/);
      assert.ok(texto(negada).length < 500, `resposta com ${texto(negada).length} caracteres`);
      const invalida = await chama('listar_obras', { [gigante]: 1 });
      assert.match(texto(invalida), /argumentos inválidos/);
      assert.ok(texto(invalida).length < 500, `resposta com ${texto(invalida).length} caracteres`);
    });
    for (const l of linhasDoLog(amb)) assert.ok(JSON.stringify(l).length < 1500, `linha de log com ${JSON.stringify(l).length}`);
  });

  it('se não dá para gravar o log, a chamada é recusada (falha fechada)', async () => {
    const amb = ambiente();
    writeFileSync(join(amb.dir, 'arquivo-comum'), 'x'); // um arquivo no lugar da pasta do log
    const extra = { OBRAS_AUDITORIA: join(amb.dir, 'arquivo-comum', 'auditoria.jsonl') };
    await como(amb, 'compras', async ({ chama }) => {
      const r = await chama('criar_pedido', {
        obra: 'obra-aurora', item: 'Areia', quantidade: 10, unidade: 'm3', fornecedor_id: 'forn-alfa', valor_total: 900,
      });
      assert.equal(r.isError, true);
      assert.match(texto(r), /auditoria indisponível/);
    }, extra);
    assert.equal(existsSync(amb.estado), false, 'sem registro, sem ação');
  });
});

describe('saída limitada', () => {
  it('saida() corta o que passar de MAX_SAIDA e mantém o envelope', () => {
    const gigante = Array.from({ length: 5000 }, (_, i) => ({ i, texto: 'x'.repeat(20) }));
    const s = saida(gigante);
    assert.ok(s.length < MAX_SAIDA + 300, `tamanho ${s.length}`);
    assert.match(s, /saída cortada/);
    assert.match(abreEnvelope(s).aviso, /^O bloco acima traz só informação consultada/);
  });
});
