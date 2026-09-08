/**
 * Teste de fumaça — sobe a API inteira contra um Postgres em memória (pg-mem)
 * e exercita os fluxos principais via HTTP de verdade. Não precisa de um
 * Neon real: serve pra pegar erros de SQL/rotas antes do deploy.
 *
 * Uso: npm test
 */
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { newDb, DataType } = require('pg-mem');

process.env.JWT_SECRET = 'segredo-de-teste-nao-usar-em-producao';
process.env.DATABASE_URL = 'postgres://fake-usado-so-pelo-pg-mem';
process.env.ALLOWED_ORIGINS = 'http://localhost:0';
process.env.PORT = '0'; // porta aleatória livre

// ---- monta um Postgres fake em memória e aplica o schema ----
const memDb = newDb({ autoCreateForeignKeyIndices: true });
memDb.public.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, impure: true, implementation: () => crypto.randomUUID() });
memDb.public.registerFunction({ name: 'now', returns: DataType.timestamptz, impure: true, implementation: () => new Date() });

const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'src', 'schema.sql'), 'utf8')
  .replace(/CREATE EXTENSION[^;]*;/i, ''); // pg-mem não precisa da extensão; a função já foi registrada acima
memDb.public.none(schemaSql);

// ---- faz `require('pg')` (usado por src/db.js) devolver o pg-mem ----
const { Pool } = memDb.adapters.createPg();
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'pg') return { Pool };
  return originalLoad.call(this, request, ...rest);
};

const app = require('../src/app');

async function main() {
  const server = app.listen(0);
  const { port } = server.address();
  const base = `http://localhost:${port}`;
  const json = (method, url, body, token) => fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));

  console.log('→ health check');
  let r = await json('GET', '/health');
  assert.strictEqual(r.status, 200);

  console.log('→ registrar líder');
  r = await json('POST', '/auth/registrar-lider', { nome: 'Carla Mendes', email: 'carla@teste.com', senha: '123456', area: 'Operações' });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  const tokenLider = r.body.token;

  console.log('→ login líder');
  r = await json('POST', '/auth/login', { email: 'carla@teste.com', senha: '123456' });
  assert.strictEqual(r.status, 200);

  console.log('→ login com senha errada deve falhar');
  r = await json('POST', '/auth/login', { email: 'carla@teste.com', senha: 'errada' });
  assert.strictEqual(r.status, 401);

  console.log('→ criar liderado');
  r = await json('POST', '/liderados', { nome: 'João Pedro', email: 'joao@teste.com', senha: '123456', cargo: 'Técnico', dataInicio: '2023-02-10' }, tokenLider);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  const liderado = r.body;

  console.log('→ login liderado');
  r = await json('POST', '/auth/login', { email: 'joao@teste.com', senha: '123456' });
  assert.strictEqual(r.status, 200);
  const tokenLiderado = r.body.token;

  console.log('→ liderado não pode listar a equipe inteira (rota de líder)');
  r = await json('GET', '/liderados', null, tokenLiderado);
  assert.strictEqual(r.status, 403);

  console.log('→ criar meta');
  r = await json('POST', '/metas', { nome: 'Reduzir retrabalho', tipo: 'operacional' }, tokenLider);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  const meta = r.body;

  console.log('→ criar atividade vinculada ao liderado e à meta');
  r = await json('POST', '/atividades', { titulo: 'Padronizar checklist', resultado: 'alto', tipo: 'operacional', status: 'andamento', responsavelId: liderado.id, metaId: meta.id }, tokenLider);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  const atividade = r.body;

  console.log('→ liderado vê a própria atividade');
  r = await json('GET', '/atividades/minhas', null, tokenLiderado);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.length, 1);

  console.log('→ mover atividade pro status concluído (kanban)');
  r = await json('PATCH', `/atividades/${atividade.id}/status`, { status: 'concluido' }, tokenLider);
  assert.strictEqual(r.status, 200);

  console.log('→ meta aparece com progresso 1/1 pro líder');
  r = await json('GET', '/metas', null, tokenLider);
  assert.strictEqual(Number(r.body[0].total_atividades), 1);
  assert.strictEqual(Number(r.body[0].atividades_concluidas), 1);

  console.log('→ liderado vê a própria meta');
  r = await json('GET', '/metas/minhas', null, tokenLiderado);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.length, 1);

  console.log('→ líder lança um feedback formal');
  r = await json('POST', '/diario', { liderado_id: liderado.id, tipo: 'feedback', data: '2026-09-08', conversa: 'Conversamos sobre o plano de carreira.', plano: 'Assumir 1 projeto piloto.' }, tokenLider);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));

  console.log('→ líder lança uma observação com risco psicossocial (não deve vazar pro liderado)');
  r = await json('POST', '/diario', { liderado_id: liderado.id, tipo: 'observacao', data: '2026-09-08', riscos: ['sobrecarga'], sinais: 'Chegou atrasado duas vezes.' }, tokenLider);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));

  console.log('→ liderado só vê o feedback formal, nunca a observação/risco interno');
  r = await json('GET', '/diario/meus-feedbacks', null, tokenLiderado);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.length, 1);
  assert.strictEqual(r.body[0].conversa, 'Conversamos sobre o plano de carreira.');
  assert.strictEqual('riscos' in r.body[0], false);
  assert.strictEqual('sinais' in r.body[0], false);

  console.log('→ visão da equipe do líder traz o resumo de todos os liderados');
  r = await json('GET', '/diario/resumo-equipe', null, tokenLider);
  assert.strictEqual(r.status, 200);
  assert.ok(r.body.length >= 2); // 1 feedback + 1 observação (DISTINCT ON liderado_id, tipo)

  console.log('→ dashboard-config cria valores padrão na primeira leitura');
  r = await json('GET', '/dashboard-config', null, tokenLider);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.ideal_operacional, 30);

  console.log('→ salvar só o checklist de erros não pode apagar o checklist do líder (nem vice-versa)');
  r = await json('PUT', '/dashboard-config', { checklistErros: { reativo: true } }, tokenLider);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.deepStrictEqual(r.body.checklist_erros, { reativo: true });
  r = await json('PUT', '/dashboard-config', { checklistLider: { 'planeja-dia': true } }, tokenLider);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.deepStrictEqual(r.body.checklist_lider, { 'planeja-dia': true });
  assert.deepStrictEqual(r.body.checklist_erros, { reativo: true }); // <- não pode ter sido apagado pelo PUT anterior
  assert.strictEqual(r.body.ideal_operacional, 30); // idem pros percentuais, que também não foram enviados agora

  console.log('→ excluir liderado remove também os registros do diário (cascade)');
  r = await json('DELETE', `/liderados/${liderado.id}`, null, tokenLider);
  assert.strictEqual(r.status, 204);
  r = await json('GET', '/diario/resumo-equipe', null, tokenLider);
  assert.strictEqual(r.body.length, 0);

  server.close();
  console.log('\n✅ Todos os fluxos passaram.');
}

main().catch(err => {
  console.error('\n❌ Falhou:', err);
  process.exit(1);
});
