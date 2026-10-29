// Passeio de 7 chamadas feitas por 5 identidades diferentes, contra o servidor de
// verdade. Usa pasta temporária: não suja data/ nem logs/. Roda com: npm run demo
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const raiz = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = mkdtempSync(join(tmpdir(), 'mcp-obras-demo-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true })); // não deixa lixo no tmp
const env = { OBRAS_ESTADO: join(dir, 'estado.json'), OBRAS_AUDITORIA: join(dir, 'auditoria.jsonl') };

// o JSON fica entre a linha de abertura <dados-xxxx> e a de fechamento
function miolo(t) {
  const linhas = t.split('\n');
  return linhas.slice(1, linhas.lastIndexOf(`</${linhas[0].slice(1, -1)}>`)).join('\n');
}

async function chama(agente, ferramenta, args = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath, args: [join(raiz, 'src', 'server.js')], cwd: raiz, stderr: 'ignore', env: { ...env, AGENTE: agente },
  });
  const client = new Client({ name: 'demo', version: '0.0.0' });
  await client.connect(transport);
  const r = await client.callTool({ name: ferramenta, arguments: args });
  await client.close();
  const t = r.content[0].text;
  const resumo = r.isError ? t.split('\n')[0] : 'ok';
  console.log(`${agente.padEnd(10)} ${ferramenta.padEnd(15)} ${JSON.stringify(args).slice(0, 60).padEnd(60)} -> ${resumo}`);
  return r.isError ? null : JSON.parse(miolo(t));
}

const pedido = { obra: 'obra-aurora', item: 'Areia lavada', quantidade: 12, unidade: 'm3', fornecedor_id: 'forn-alfa', valor_total: 1200 };
await chama('leitura', 'listar_obras');
await chama('leitura', 'criar_pedido', pedido);
await chama('campo', 'resumo_obra', { obra: 'obra-horizonte' });
const novo = await chama('compras', 'criar_pedido', pedido);
await chama('compras', 'aprovar_pedido', { pedido_id: novo.id });
await chama('financeiro', 'aprovar_pedido', { pedido_id: novo.id });
await chama('fantasma', 'listar_obras');

console.log('\nauditoria (uma linha por chamada):');
for (const l of readFileSync(env.OBRAS_AUDITORIA, 'utf8').trim().split('\n')) {
  const { ts, agente, ferramenta, decisao, codigo } = JSON.parse(l);
  console.log(`${ts}  ${agente.padEnd(10)} ${ferramenta.padEnd(15)} ${decisao}${codigo ? ` (${codigo})` : ''}`);
}
