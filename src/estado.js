import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// "Banco de dados" de demonstração: um JSON. Lê o estado salvo se existir,
// senão parte dos dados fictícios de data/dados.json.
// Limitação: leitura e escrita do arquivo inteiro a cada chamada, sem trava entre
// processos (dois agentes escrevendo no mesmo instante: vale o último). Num uso
// real isso é um banco com transação (ver docs/arquitetura.md, "O que falta").
export function carrega(caminhoEstado, caminhoSeed) {
  return JSON.parse(readFileSync(existsSync(caminhoEstado) ? caminhoEstado : caminhoSeed, 'utf8'));
}

// Grava em arquivo temporário e renomeia, para nunca deixar o JSON pela metade.
export function salva(caminho, dados) {
  mkdirSync(dirname(caminho), { recursive: true });
  const tmp = `${caminho}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(dados, null, 2) + '\n');
  renameSync(tmp, caminho);
}
