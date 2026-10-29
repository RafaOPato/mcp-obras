# Conectar ao Claude Desktop e ao Claude Code

A ideia é a mesma nos dois: um servidor MCP por agente, cada um com o seu `AGENTE` no bloco `env`. O servidor não lê `.env`; o que vale é o `env` da configuração.

Antes: rode `npm install` na pasta do projeto e use o **caminho absoluto** do `src/server.js` (nos exemplos, `/caminho/para/mcp-obras`; no Windows, algo como `C:\\caminho\\para\\mcp-obras\\src\\server.js`, com barras duplas dentro do JSON).

> Estado desta documentação: o formato abaixo segue o que os dois clientes documentam, mas não foi conferido dentro do Claude Desktop nem do Claude Code. O que foi testado é o mesmo comando e as mesmas variáveis de ambiente pelo cliente do SDK (`npm test`).

## Claude Code (`.mcp.json`)

Crie um arquivo `.mcp.json` na raiz do projeto em que você usa o Claude Code. Dois agentes ao mesmo tempo mostram a diferença de permissão:

```json
{
  "mcpServers": {
    "obras-leitura": {
      "command": "node",
      "args": ["/caminho/para/mcp-obras/src/server.js"],
      "env": { "AGENTE": "leitura" }
    },
    "obras-compras": {
      "command": "node",
      "args": ["/caminho/para/mcp-obras/src/server.js"],
      "env": { "AGENTE": "compras" }
    }
  }
}
```

Se você abrir o Claude Code dentro da própria pasta `mcp-obras`, `"args": ["src/server.js"]` também funciona. Na primeira vez, o Claude Code pede para você aprovar os servidores do `.mcp.json`.

## Claude Desktop (`claude_desktop_config.json`)

No Claude Desktop, abra Configurações, Desenvolvedor, Editar configuração, e acrescente:

```json
{
  "mcpServers": {
    "obras-financeiro": {
      "command": "node",
      "args": ["/caminho/para/mcp-obras/src/server.js"],
      "env": { "AGENTE": "financeiro" }
    }
  }
}
```

Reinicie o Claude Desktop depois de salvar.

## Variáveis opcionais

Pelo mesmo bloco `env`: `OBRAS_AGENTES` (outro arquivo de política), `OBRAS_ESTADO` (onde ficam os pedidos criados) e `OBRAS_AUDITORIA` (onde vai o log). Os padrões ficam na raiz do projeto e valem de qualquer pasta; ao definir uma dessas variáveis, use caminho absoluto, porque um caminho relativo vale a partir da pasta em que o cliente rodou o comando (no Claude Desktop, não é a do projeto). Para dois agentes enxergarem os mesmos pedidos, os dois precisam apontar para o mesmo `OBRAS_ESTADO` (o padrão já é o mesmo arquivo).

## Para ver funcionando sem nenhum cliente

`npm run demo` faz 7 chamadas como 5 identidades diferentes (uma delas, `fantasma`, não existe) e imprime o log de auditoria no final.

Também dá para falar com o servidor na mão, em bash, dentro da pasta `mcp-obras` (testado no Git Bash). O `sleep` mantém o stdin aberto até a resposta chegar:

```bash
(printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"cli","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"criar_pedido","arguments":{}}}'; sleep 2) \
  | AGENTE=leitura node src/server.js
```

A última resposta deve ser `NEGADO [FERRAMENTA_NAO_PERMITIDA]`: o agente `leitura` não tem `criar_pedido`. Isso grava uma linha em `logs/auditoria.jsonl`.

## Conferindo o que aconteceu

```bash
cat logs/auditoria.jsonl
```

Cada linha é um JSON: `ts`, `agente`, `ferramenta`, `decisao`, e quando negada, `codigo` e `motivo` (`motivo` também aparece em `invalido` e `erro`).
