import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Uma linha JSON por chamada, sempre no fim do arquivo (nunca reescreve).
// Devolve false se não conseguiu gravar: quem chama decide (o servidor recusa
// a chamada, porque ação sem registro não deve acontecer).
export function audita(caminho, entrada) {
  try {
    mkdirSync(dirname(caminho), { recursive: true });
    appendFileSync(caminho, JSON.stringify({ ts: new Date().toISOString(), ...entrada }) + '\n');
    return true;
  } catch (e) {
    console.error('falha ao gravar a auditoria:', e.message); // stderr: stdout é do protocolo
    return false;
  }
}

// Argumentos grandes não entram inteiros no log.
export function resume(args, max = 500) {
  const texto = JSON.stringify(args ?? {});
  return texto.length <= max ? (args ?? {}) : { _truncado: texto.slice(0, max) };
}
