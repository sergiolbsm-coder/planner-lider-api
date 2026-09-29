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
// pg-mem não implementa "date - date" (o Postgres de verdade devolve um integer de dias) — só pro teste.
memDb.public.registerOperator({ operator: '-', left: DataType.date, right: DataType.date, returns: DataType.integer, implementation: (a, b) => (a === null || b === null) ? null : Math.round((a - b) / 86400000) });

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
  const hoje = new Date().toISOString().slice(0, 10); // usa "hoje" de verdade, não uma data fixa
  const server = app.listen(0);
  const { port } = server.address();
  const base = `http://localhost:${port}`;
  const json = (method, url, body, token) => fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));

  const upload = (url, formData, token) => fetch(base + url, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));

  const download = (url, token) => fetch(base + url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }).then(async r => ({ status: r.status, buffer: Buffer.from(await r.arrayBuffer()), headers: r.headers }));

  console.log('→ health check');
  let r = await json('GET', '/health');
  assert.strictEqual(r.status, 200);

  console.log('→ bootstrap do administrador (só funciona uma vez)');
  r = await json('POST', '/auth/bootstrap-admin', { nome: 'Admin do Instituto', email: 'admin@teste.com', senha: '123456' });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  const tokenAdmin = r.body.token;
  r = await json('POST', '/auth/bootstrap-admin', { nome: 'Outro Admin', email: 'outroadmin@teste.com', senha: '123456' });
  assert.strictEqual(r.status, 403, JSON.stringify(r.body)); // já existe um admin — não deixa criar outro

  console.log('→ admin cria uma turma e um líder dentro dela');
  r = await json('POST', '/admin/turmas', { nome: 'Turma 2026.1' }, tokenAdmin);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  const turmaId = r.body.id;
  r = await json('POST', `/admin/turmas/${turmaId}/lideres`, { nome: 'Carla Mendes', email: 'carla@teste.com', senha: '123456', area: 'Operações' }, tokenAdmin);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  const carlaLiderId = r.body.id;

  console.log('→ mesmo e-mail não pode repetir como líder DENTRO da mesma turma');
  r = await json('POST', `/admin/turmas/${turmaId}/lideres`, { nome: 'Carla Duplicada', email: 'carla@teste.com', senha: '123456' }, tokenAdmin);
  assert.strictEqual(r.status, 409, JSON.stringify(r.body));

  console.log('→ mas o mesmo e-mail PODE ser líder em outra turma (ex: o próprio admin testando)');
  const turmaExtra = await json('POST', '/admin/turmas', { nome: 'Turma 2026.Extra' }, tokenAdmin);
  r = await json('POST', `/admin/turmas/${turmaExtra.body.id}/lideres`, { nome: 'Admin do Instituto', email: 'admin@teste.com', senha: '123456' }, tokenAdmin);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  const liderMesmoEmailDoAdminId = r.body.id;

  console.log('→ login com e-mail que bate em mais de uma conta devolve a lista pra escolher');
  r = await json('POST', '/auth/login', { email: 'admin@teste.com', senha: '123456' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.ok(Array.isArray(r.body.contas) && r.body.contas.length === 2, 'deveria listar as 2 contas com esse e-mail/senha');
  assert.ok(r.body.contas.some(c => c.role === 'admin'));
  assert.ok(r.body.contas.some(c => c.role === 'lider' && c.turmaNome === 'Turma 2026.Extra'));

  console.log('→ login escolhendo a conta de líder (contaId) entra como líder, não como admin');
  r = await json('POST', '/auth/login', { email: 'admin@teste.com', senha: '123456', contaId: liderMesmoEmailDoAdminId });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.user.role, 'lider');
  assert.strictEqual(r.body.user.id, liderMesmoEmailDoAdminId);
  const tokenLiderMesmoEmailDoAdmin = r.body.token;

  console.log('→ GET /auth/minhas-contas lista as duas contas do mesmo e-mail');
  r = await json('GET', '/auth/minhas-contas', null, tokenLiderMesmoEmailDoAdmin);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.length, 2);
  assert.ok(r.body.some(c => c.role === 'admin'));
  assert.ok(r.body.some(c => c.role === 'lider' && c.id === liderMesmoEmailDoAdminId));

  console.log('→ trocar de conta sem senha, direto pra conta admin do mesmo e-mail');
  r = await json('POST', '/auth/trocar-conta', { contaId: null }, tokenLiderMesmoEmailDoAdmin);
  assert.strictEqual(r.status, 400); // sem contaId
  const contaAdminId = (await json('GET', '/auth/minhas-contas', null, tokenLiderMesmoEmailDoAdmin)).body.find(c => c.role === 'admin').id;
  r = await json('POST', '/auth/trocar-conta', { contaId: contaAdminId }, tokenLiderMesmoEmailDoAdmin);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.user.role, 'admin');

  console.log('→ trocar de conta pra uma conta de e-mail diferente é bloqueado');
  r = await json('POST', '/auth/trocar-conta', { contaId: carlaLiderId }, tokenLiderMesmoEmailDoAdmin);
  assert.strictEqual(r.status, 403, JSON.stringify(r.body)); // carla@teste.com é outro e-mail

  console.log('→ admin edita o nome da turma');
  r = await json('PUT', `/admin/turmas/${turmaId}`, { nome: 'Turma 2026.1 (renomeada)' }, tokenAdmin);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.nome, 'Turma 2026.1 (renomeada)');
  r = await json('PUT', `/admin/turmas/${turmaId}`, { nome: 'Turma 2026.1' }, tokenAdmin); // volta o nome original pro resto do teste
  assert.strictEqual(r.status, 200);

  console.log('→ login líder');
  r = await json('POST', '/auth/login', { email: 'carla@teste.com', senha: '123456' });
  assert.strictEqual(r.status, 200);
  const tokenLider = r.body.token;

  console.log('→ líder não acessa rotas de admin');
  r = await json('POST', '/admin/turmas', { nome: 'Outra Turma' }, tokenLider);
  assert.strictEqual(r.status, 403);

  console.log('→ login com senha errada deve falhar');
  r = await json('POST', '/auth/login', { email: 'carla@teste.com', senha: 'errada' });
  assert.strictEqual(r.status, 401);

  console.log('→ criar liderado');
  r = await json('POST', '/liderados', { nome: 'João Pedro', email: 'joao@teste.com', senha: '123456', cargo: 'Técnico', dataInicio: '2023-02-10' }, tokenLider);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  const liderado = r.body;

  console.log('→ criar liderado só com nome (e-mail/senha de acesso agora são opcionais)');
  r = await json('POST', '/liderados', { nome: 'Beatriz Lima', cargo: 'Estagiária' }, tokenLider);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  assert.strictEqual(r.body.email, null);
  const lideradoSemAcesso = r.body;

  console.log('→ enviar só o e-mail sem a senha (ou vice-versa) é rejeitado');
  r = await json('POST', '/liderados', { nome: 'Sem Senha', email: 'semsenha@teste.com' }, tokenLider);
  assert.strictEqual(r.status, 400);
  r = await json('POST', '/liderados', { nome: 'Sem Email', senha: '123456' }, tokenLider);
  assert.strictEqual(r.status, 400);

  console.log('→ liberar o acesso depois, via PUT, com e-mail e senha juntos');
  r = await json('PUT', `/liderados/${lideradoSemAcesso.id}`, { email: 'beatriz@teste.com', senha: '123456' }, tokenLider);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.email, 'beatriz@teste.com');
  r = await json('POST', '/auth/login', { email: 'beatriz@teste.com', senha: '123456' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));

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
  assert.strictEqual(meta.status_execucao, 'no_prazo'); // default quando não informado

  console.log('→ criar meta completa (Painel do Líder: Direção, Meta e Medição, BSC, OKR, Execução)');
  r = await json('POST', '/metas', {
    nome: 'Aumentar NPS da área', tipo: 'estrategico', indicador: 'NPS',
    pontoPartida: '42 pts', valor: '60 pts', prazo: '2026-12-31', frequenciaAcompanhamento: 'mensal',
    porqueImporta: 'NPS baixo está gerando churn de clientes internos.',
    perspectivaBsc: 'clientes',
    okrObjetivo: 'Elevar a satisfação percebida pelos clientes internos',
    okrKr1: 'NPS de 42 para 60', okrKr2: 'Reduzir tempo de resposta em 30%', okrKr3: '',
    acaoPrioritaria: 'Mapear os 3 principais motivos de detração', responsavelAcao: 'Carla Mendes',
    proximaVerificacao: '2026-11-01', statusExecucao: 'atencao',
  }, tokenLider);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  const metaCompleta = r.body;
  assert.strictEqual(metaCompleta.ponto_partida, '42 pts');
  assert.strictEqual(metaCompleta.perspectiva_bsc, 'clientes');
  assert.strictEqual(metaCompleta.okr_kr1, 'NPS de 42 para 60');
  assert.strictEqual(metaCompleta.status_execucao, 'atencao');

  console.log('→ perspectiva do BSC inválida é rejeitada');
  r = await json('POST', '/metas', { nome: 'Meta inválida', tipo: 'tatico', perspectivaBsc: 'marketing' }, tokenLider);
  assert.strictEqual(r.status, 400);

  console.log('→ atualizar meta completa via PUT parcial (COALESCE não apaga os outros campos novos)');
  r = await json('PUT', `/metas/${metaCompleta.id}`, { statusExecucao: 'concluido' }, tokenLider);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.status_execucao, 'concluido');
  assert.strictEqual(r.body.perspectiva_bsc, 'clientes'); // não foi reenviado, tem que continuar
  assert.strictEqual(r.body.okr_kr1, 'NPS de 42 para 60');

  console.log('→ criar atividade vinculada ao liderado e à meta');
  r = await json('POST', '/atividades', { titulo: 'Padronizar checklist', resultado: 'alto', tipo: 'operacional', status: 'andamento', responsavelId: liderado.id, metaId: meta.id }, tokenLider);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  const atividade = r.body;
  assert.strictEqual(atividade.tipo_vinculo, 'meta'); // metaId sem tipoVinculo assume 'meta' (compatibilidade)

  console.log('→ vincular atividade ao OKR de uma meta');
  r = await json('POST', '/atividades', { titulo: 'Mapear motivos de detração', resultado: 'alto', tipo: 'estrategico', tipoVinculo: 'okr', metaId: metaCompleta.id }, tokenLider);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  assert.strictEqual(r.body.tipo_vinculo, 'okr');
  assert.strictEqual(r.body.meta_id, metaCompleta.id);

  console.log('→ vincular atividade à perspectiva do BSC de uma meta');
  r = await json('POST', '/atividades', { titulo: 'Entrevistar clientes detratores', resultado: 'medio', tipo: 'tatico', tipoVinculo: 'bsc', metaId: metaCompleta.id }, tokenLider);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  assert.strictEqual(r.body.tipo_vinculo, 'bsc');

  console.log('→ vincular atividade a um item do Plano de Ação');
  r = await json('GET', '/plano-acao', null, tokenLider);
  assert.strictEqual(r.status, 200);
  assert.ok(r.body.length > 0, 'a seed padrão devia ter criado itens de plano de ação pro líder');
  const itemPlanoAcao = r.body[0];
  r = await json('POST', '/atividades', { titulo: 'Executar ação do plano', resultado: 'alto', tipo: 'operacional', tipoVinculo: 'plano_acao', planoAcaoId: itemPlanoAcao.id }, tokenLider);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  assert.strictEqual(r.body.tipo_vinculo, 'plano_acao');
  assert.strictEqual(r.body.plano_acao_id, itemPlanoAcao.id);
  assert.strictEqual(r.body.meta_id, null);

  console.log('→ vincular a plano_acao sem informar o item é rejeitado');
  r = await json('POST', '/atividades', { titulo: 'Sem item', resultado: 'alto', tipo: 'operacional', tipoVinculo: 'plano_acao' }, tokenLider);
  assert.strictEqual(r.status, 400);

  console.log('→ vincular a um item de plano de ação de outro líder é rejeitado');
  r = await json('POST', '/atividades', { titulo: 'Item de outro líder', resultado: 'alto', tipo: 'operacional', tipoVinculo: 'plano_acao', planoAcaoId: '00000000-0000-0000-0000-000000000000' }, tokenLider);
  assert.strictEqual(r.status, 400);

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
  r = await json('POST', '/diario', { liderado_id: liderado.id, tipo: 'feedback', data: hoje, conversa: 'Conversamos sobre o plano de carreira.', plano: 'Assumir 1 projeto piloto.' }, tokenLider);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));

  console.log('→ líder lança uma observação com risco psicossocial E evolução (não deve vazar pro liderado)');
  r = await json('POST', '/diario', { liderado_id: liderado.id, tipo: 'observacao', data: hoje, riscos: ['sobrecarga'], evolucao: ['iniciativa'], sinais: 'Chegou atrasado duas vezes.' }, tokenLider);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  assert.deepStrictEqual(r.body.evolucao, ['iniciativa']);

  console.log('→ líder lança feedback formal com a ferramenta Sanduíche');
  r = await json('POST', '/diario', {
    liderado_id: liderado.id, tipo: 'feedback', data: hoje, ferramentaFeedback: 'sanduiche',
    fbSanduichePositivo1: 'Entrega sempre no prazo.', fbSanduicheMelhoria: 'Comunicar bloqueios mais cedo.', fbSanduichePositivo2: 'Ótima colaboração com o time.',
  }, tokenLider);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  assert.strictEqual(r.body.ferramenta_feedback, 'sanduiche');
  assert.strictEqual(r.body.fb_sanduiche_melhoria, 'Comunicar bloqueios mais cedo.');

  console.log('→ líder lança feedback formal com Feedforward (+ e Delta)');
  r = await json('POST', '/diario', {
    liderado_id: liderado.id, tipo: 'feedback', data: hoje, ferramentaFeedback: 'feedforward',
    fbFeedforwardMais: 'A apresentação pro cliente foi excelente.', fbFeedforwardDelta: 'Preparar um resumo executivo antes da próxima.',
  }, tokenLider);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  assert.strictEqual(r.body.ferramenta_feedback, 'feedforward');

  console.log('→ líder lança feedback formal com Comece-Pare-Continue');
  r = await json('POST', '/diario', {
    liderado_id: liderado.id, tipo: 'feedback', data: hoje, ferramentaFeedback: 'comece_pare_continue',
    fbCpcComece: 'Compartilhar status semanal proativamente.', fbCpcPare: 'Deixar decisões pra última hora.', fbCpcContinue: 'Ajudar os colegas mais novos.',
  }, tokenLider);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  assert.strictEqual(r.body.ferramenta_feedback, 'comece_pare_continue');

  console.log('→ ferramenta de feedback inválida é rejeitada');
  r = await json('POST', '/diario', { liderado_id: liderado.id, tipo: 'feedback', data: hoje, ferramentaFeedback: 'not-a-tool' }, tokenLider);
  assert.strictEqual(r.status, 400);

  console.log('→ liderado só vê o feedback formal (com a ferramenta usada), nunca a observação/risco interno');
  r = await json('GET', '/diario/meus-feedbacks', null, tokenLiderado);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.length, 4); // o original + sanduiche + feedforward + cpc
  assert.strictEqual(r.body.find(f => f.ferramenta_feedback === 'sanduiche').fb_sanduiche_positivo1, 'Entrega sempre no prazo.');
  assert.strictEqual('riscos' in r.body[0], false);
  assert.strictEqual('sinais' in r.body[0], false);
  assert.strictEqual('evolucao' in r.body[0], false);

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

  console.log('→ estatísticas de reuniões contam os registros do diário e apontam o líder sem parar');
  r = await json('GET', '/diario/estatisticas', null, tokenLider);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.ultimos7Dias, 5); // 1 observação + 4 feedbacks (sem ferramenta, sanduíche, feedforward, cpc) lançados acima
  assert.strictEqual(r.body.acumuladoAno, 5);
  // 0 ou 1 pela diferença de fuso entre a data inserida (UTC) e o CURRENT_DATE
  // interno do pg-mem — no Postgres de verdade isso é sempre 0 aqui, é só o mock.
  assert.ok(r.body.diasSemReuniao === 0 || r.body.diasSemReuniao === 1, `esperado 0 ou 1, veio ${r.body.diasSemReuniao}`);
  assert.strictEqual(r.body.porLiderado.length, 2); // João Pedro + Beatriz Lima (cadastrada sem acesso acima)
  assert.strictEqual(r.body.porLiderado.find(p => p.id === liderado.id).total, 5);
  assert.strictEqual(r.body.porLiderado.find(p => p.id === lideradoSemAcesso.id).total, 0);

  console.log('→ autoavaliação mensal: mês novo vem vazio, upsert grava e não duplica');
  const mesRef = hoje.slice(0, 7);
  r = await json('GET', `/autoavaliacoes/${mesRef}`, null, tokenLider);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.deepStrictEqual(r.body.respostas, {});
  r = await json('PUT', `/autoavaliacoes/${mesRef}`, { respostas: { reativo: true, 'planeja-dia': false } }, tokenLider);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  r = await json('PUT', `/autoavaliacoes/${mesRef}`, { respostas: { reativo: false, 'planeja-dia': true } }, tokenLider);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.deepStrictEqual(r.body.respostas, { reativo: false, 'planeja-dia': true }); // sobrescreveu, não mesclou
  r = await json('GET', '/autoavaliacoes', null, tokenLider);
  assert.strictEqual(r.body.length, 1); // upsert no mesmo mês não duplica linha

  console.log('→ admin sobe um arquivo de aula pra turma (multipart)');
  const conteudoOriginal = Buffer.from('%PDF-1.4 conteúdo de mentira só pro teste');
  const form = new FormData();
  form.append('arquivo', new Blob([conteudoOriginal], { type: 'application/pdf' }), 'aula-01.pdf');
  form.append('nome', 'Aula 01 — Introdução');
  form.append('descricao', 'Slides da primeira aula.');
  form.append('pasta', 'Módulo 1');
  r = await upload(`/admin/turmas/${turmaId}/arquivos`, form, tokenAdmin);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  assert.strictEqual(r.body.tamanho_bytes, conteudoOriginal.length);
  assert.strictEqual(r.body.pasta, 'Módulo 1');
  assert.strictEqual('conteudo' in r.body, false); // metadados não trazem o binário junto
  const arquivoId = r.body.id;

  console.log('→ líder não pode subir/editar/excluir arquivos — só ler e baixar');
  r = await upload(`/admin/turmas/${turmaId}/arquivos`, form, tokenLider);
  assert.strictEqual(r.status, 403);
  r = await json('PUT', `/admin/arquivos/${arquivoId}`, { nome: 'x' }, tokenLider);
  assert.strictEqual(r.status, 403);

  console.log('→ admin move o arquivo pra outra pasta (PUT não apaga o resto por ser parcial)');
  r = await json('PUT', `/admin/arquivos/${arquivoId}`, { nome: 'Aula 01 — Introdução', descricao: 'Slides da primeira aula.', pasta: 'Módulo 2' }, tokenAdmin);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.pasta, 'Módulo 2');
  r = await json('GET', '/arquivos', null, tokenLider);
  assert.strictEqual(r.body[0].pasta, 'Módulo 2');

  console.log('→ upload sem arquivo é rejeitado');
  const formVazio = new FormData();
  formVazio.append('nome', 'Sem arquivo');
  r = await upload(`/admin/turmas/${turmaId}/arquivos`, formVazio, tokenAdmin);
  assert.strictEqual(r.status, 400);

  console.log('→ liderado enxerga o arquivo da turma do seu líder (metadados) e consegue baixar o conteúdo original');
  r = await json('GET', '/arquivos/minha-turma', null, tokenLiderado);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.length, 1);
  assert.strictEqual(r.body[0].nome, 'Aula 01 — Introdução');

  let baixado = await download(`/arquivos/${arquivoId}/download`, tokenLiderado);
  assert.strictEqual(baixado.status, 200);
  assert.ok(baixado.buffer.equals(conteudoOriginal), 'conteúdo baixado deve ser idêntico ao enviado');
  assert.strictEqual(baixado.headers.get('content-type'), 'application/pdf');

  console.log('→ liderado de outra turma não consegue baixar o arquivo (404, não vaza existência)');
  const outraTurma = await json('POST', '/admin/turmas', { nome: 'Turma 2026.2' }, tokenAdmin);
  const outroLider = await json('POST', `/admin/turmas/${outraTurma.body.id}/lideres`, { nome: 'Outra Líder', email: 'outra@teste.com', senha: '123456' }, tokenAdmin);
  const loginOutroLider = await json('POST', '/auth/login', { email: 'outra@teste.com', senha: '123456' });
  const outroLiderTokenTmp = loginOutroLider.body.token;
  const outroLiderado = await json('POST', '/liderados', { nome: 'Fulano', email: 'fulano@teste.com', senha: '123456' }, outroLiderTokenTmp);
  const loginOutroLiderado = await json('POST', '/auth/login', { email: 'fulano@teste.com', senha: '123456' });
  baixado = await download(`/arquivos/${arquivoId}/download`, loginOutroLiderado.body.token);
  assert.strictEqual(baixado.status, 404);
  r = await json('GET', '/arquivos', null, outroLiderTokenTmp);
  assert.strictEqual(r.body.length, 0); // trilha/arquivos da outra turma estão vazios pra esse líder

  console.log('→ admin vincula o mesmo arquivo à outra turma (copiar/vincular sem duplicar conteúdo)');
  r = await json('POST', `/admin/arquivos/${arquivoId}/vincular`, { turmaId: outraTurma.body.id }, tokenAdmin);
  assert.strictEqual(r.status, 204, JSON.stringify(r.body));
  r = await json('GET', '/arquivos', null, outroLiderTokenTmp);
  assert.strictEqual(r.body.length, 1); // agora aparece pra essa turma também
  baixado = await download(`/arquivos/${arquivoId}/download`, loginOutroLiderado.body.token);
  assert.strictEqual(baixado.status, 200); // e o liderado dela já consegue baixar
  assert.ok(baixado.buffer.equals(conteudoOriginal));

  console.log('→ vincular a pasta inteira de uma vez ("copiar pasta pra outra turma")');
  const terceiraTurma = await json('POST', '/admin/turmas', { nome: 'Turma 2026.3' }, tokenAdmin);
  r = await json('POST', `/admin/turmas/${turmaId}/pastas/vincular`, { pasta: 'Módulo 2', turmaDestinoId: terceiraTurma.body.id }, tokenAdmin);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.vinculados, 1);

  console.log('→ transferir uma pasta inteira pra outra turma (fica uma cópia lá e outra na origem)');
  const form2 = new FormData();
  form2.append('arquivo', new Blob([conteudoOriginal], { type: 'application/pdf' }), 'aula-03.pdf');
  form2.append('nome', 'Aula 03');
  form2.append('pasta', 'Módulo 3');
  r = await upload(`/admin/turmas/${turmaId}/arquivos`, form2, tokenAdmin);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  const arquivoId2 = r.body.id;

  const quartaTurma = await json('POST', '/admin/turmas', { nome: 'Turma 2026.4' }, tokenAdmin);
  r = await json('POST', `/admin/turmas/${turmaId}/pastas/transferir`, { pasta: 'Módulo 3', turmaDestinoId: quartaTurma.body.id }, tokenAdmin);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.transferidos, 1);

  r = await json('GET', `/admin/turmas/${turmaId}/arquivos`, null, tokenAdmin);
  assert.ok(r.body.some(a => a.id === arquivoId2), 'arquivo transferido tem que continuar na turma de origem (cópia)');
  r = await json('GET', `/admin/turmas/${quartaTurma.body.id}/arquivos`, null, tokenAdmin);
  assert.ok(r.body.some(a => a.id === arquivoId2), 'arquivo transferido tem que aparecer na turma de destino');

  console.log('→ remover de uma turma só desvincula (o arquivo continua nas outras)');
  r = await json('DELETE', `/admin/turmas/${turmaId}/arquivos/${arquivoId}`, null, tokenAdmin);
  assert.strictEqual(r.status, 204, JSON.stringify(r.body));
  r = await json('GET', '/arquivos', null, tokenLider);
  assert.strictEqual(r.body.length, 1); // arquivoId sumiu, mas sobra a cópia do arquivoId2 (transferir manteve a cópia aqui)
  r = await json('GET', '/arquivos', null, outroLiderTokenTmp);
  assert.strictEqual(r.body.length, 1); // mas continua na turma vinculada depois

  console.log('→ admin exclui o arquivo da última turma vinculada e ele desaparece de vez');
  r = await json('DELETE', `/admin/turmas/${outraTurma.body.id}/arquivos/${arquivoId}`, null, tokenAdmin);
  assert.strictEqual(r.status, 204);
  r = await json('DELETE', `/admin/turmas/${terceiraTurma.body.id}/arquivos/${arquivoId}`, null, tokenAdmin);
  assert.strictEqual(r.status, 204);
  r = await json('GET', '/arquivos', null, tokenLider);
  assert.strictEqual(r.body.length, 1); // arquivoId foi de vez; a cópia do arquivoId2 continua

  console.log('→ admin monta a trilha de desafios da turma (título/prazo/pontos)');
  r = await json('POST', `/admin/turmas/${turmaId}/desafios`, { titulo: 'Montar minha equipe', descricao: 'Cadastrar liderados.', secaoAlvo: 'liderados', prazo: '2099-01-01', pontos: 20, ordem: 0 }, tokenAdmin);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  const desafioId = r.body.id;
  assert.strictEqual(r.body.pontos, 20);

  console.log('→ líder não pode criar, editar nem excluir desafios — só o admin parametriza a trilha');
  r = await json('POST', `/admin/turmas/${turmaId}/desafios`, { titulo: 'Tentativa de líder' }, tokenLider);
  assert.strictEqual(r.status, 403);
  r = await json('PUT', `/admin/desafios/${desafioId}`, { titulo: 'x' }, tokenLider);
  assert.strictEqual(r.status, 403);
  r = await json('DELETE', `/admin/desafios/${desafioId}`, null, tokenLider);
  assert.strictEqual(r.status, 403);

  console.log('→ item criado sem pontos definidos usa o padrão (10)');
  r = await json('POST', `/admin/turmas/${turmaId}/desafios`, { titulo: 'Item sem pontuação explícita' }, tokenAdmin);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  assert.strictEqual(r.body.pontos, 10);
  const desafioSemPontosId = r.body.id;

  console.log('→ líder lê a trilha da própria turma, ainda sem progresso');
  r = await json('GET', '/desafios', null, tokenLider);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.length, 2);
  assert.strictEqual(r.body[0].concluido, false);
  assert.strictEqual(r.body[0].concluido_em, null);

  console.log('→ líder marca um desafio como concluído — grava progresso individual, não mexe na trilha');
  r = await json('PUT', `/desafios/${desafioId}`, { concluido: true }, tokenLider);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.concluido, true);
  assert.ok(r.body.concluido_em, 'concluido_em deveria ter sido preenchido ao marcar concluído');
  r = await json('GET', '/desafios', null, tokenLider);
  assert.strictEqual(r.body.find(d => d.id === desafioId).concluido, true);
  assert.strictEqual(r.body.find(d => d.id === desafioSemPontosId).concluido, false); // o outro item continua pendente

  console.log('→ desmarcar como pendente limpa concluido_em');
  r = await json('PUT', `/desafios/${desafioId}`, { concluido: false }, tokenLider);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.concluido, false);
  assert.strictEqual(r.body.concluido_em, null);

  console.log('→ admin edita texto sem precisar reenviar prazo/seção (PUT parcial via COALESCE)');
  r = await json('PUT', `/admin/desafios/${desafioId}`, { titulo: 'Montar e conhecer minha equipe' }, tokenAdmin);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.titulo, 'Montar e conhecer minha equipe');
  assert.ok(r.body.prazo, 'prazo não pode ter sido apagado por um PUT que não mencionou o campo');
  assert.strictEqual(r.body.secao_alvo, 'liderados'); // idem

  console.log('→ admin limpa prazo/seção explicitamente (null é um valor válido, não "campo omitido")');
  r = await json('PUT', `/admin/desafios/${desafioId}`, { prazo: null, secaoAlvo: null }, tokenAdmin);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.prazo, null);
  assert.strictEqual(r.body.secao_alvo, null);

  console.log('→ líder de outra turma não vê nem consegue marcar progresso na trilha desta turma');
  r = await json('GET', '/desafios', null, outroLiderTokenTmp);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.length, 0); // a trilha da turma dele está vazia
  r = await json('PUT', `/desafios/${desafioId}`, { concluido: true }, outroLiderTokenTmp);
  assert.strictEqual(r.status, 404); // desafio não pertence à turma desse líder

  console.log('→ admin exclui um item e ele some da trilha (pro líder também)');
  r = await json('DELETE', `/admin/desafios/${desafioSemPontosId}`, null, tokenAdmin);
  assert.strictEqual(r.status, 204);
  r = await json('GET', '/desafios', null, tokenLider);
  assert.strictEqual(r.body.length, 1);

  console.log('→ admin reatribui um líder pra outra turma (ex: conta criada antes de turmas existirem)');
  r = await json('GET', '/admin/lideres', null, tokenAdmin);
  assert.strictEqual(r.status, 200);
  assert.ok(r.body.length >= 2);
  r = await json('PUT', `/admin/lideres/${outroLider.body.id}`, { turmaId }, tokenAdmin);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.turma_id, turmaId);

  console.log('→ admin redefine a senha de um líder já cadastrado');
  r = await json('PUT', `/admin/lideres/${outroLider.body.id}/senha`, { senha: 'novaSenha123' }, tokenAdmin);
  assert.strictEqual(r.status, 204, JSON.stringify(r.body));
  r = await json('POST', '/auth/login', { email: 'outra@teste.com', senha: '123456' });
  assert.strictEqual(r.status, 401, 'senha antiga não deveria funcionar mais'); // outra@teste.com não tem conta duplicada, então isso é mesmo credencial inválida
  r = await json('POST', '/auth/login', { email: 'outra@teste.com', senha: 'novaSenha123' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));

  console.log('→ redefinir senha com menos de 6 caracteres é rejeitado');
  r = await json('PUT', `/admin/lideres/${outroLider.body.id}/senha`, { senha: '123' }, tokenAdmin);
  assert.strictEqual(r.status, 400);

  console.log('→ redefinir senha de líder inexistente devolve 404');
  r = await json('PUT', `/admin/lideres/00000000-0000-0000-0000-000000000000/senha`, { senha: '123456' }, tokenAdmin);
  assert.strictEqual(r.status, 404);

  console.log('→ plano de gestão: leitura antes de salvar vem vazia, sem criar linha');
  r = await json('GET', '/plano-gestao', null, tokenLider);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.visao_missao, '');
  assert.strictEqual(r.body.de_onde_viemos, '');

  console.log('→ plano de gestão: salvar só a visão não pode apagar o lema salvo depois (PUT parcial)');
  r = await json('PUT', '/plano-gestao', { visaoMissao: 'Ser referência em excelência operacional.' }, tokenLider);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  r = await json('PUT', '/plano-gestao', { lemaDoAno: 'Simplificar para crescer' }, tokenLider);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.lema_do_ano, 'Simplificar para crescer');
  assert.strictEqual(r.body.visao_missao, 'Ser referência em excelência operacional.'); // <- não pode ter sido apagada

  console.log('→ plano de gestão: Ferramenta Avião salva sem apagar os campos da Criação do Plano');
  r = await json('PUT', '/plano-gestao', { deOndeViemos: 'Começamos como uma área de suporte.', paraOndeVamos: 'Ser referência em resultado e cultura.' }, tokenLider);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.de_onde_viemos, 'Começamos como uma área de suporte.');
  assert.strictEqual(r.body.para_onde_vamos, 'Ser referência em resultado e cultura.');
  assert.strictEqual(r.body.lema_do_ano, 'Simplificar para crescer'); // <- não pode ter sido apagado

  console.log('→ diagnóstico: brainstorm de desafios e oportunidades');
  r = await json('POST', '/diagnostico', { tipo: 'desafio', texto: 'Alta rotatividade no turno da noite' }, tokenLider);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  const diagnosticoId = r.body.id;
  r = await json('POST', '/diagnostico', { tipo: 'oportunidade', texto: 'Automatizar o relatório semanal' }, tokenLider);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  r = await json('POST', '/diagnostico', { tipo: 'invalido', texto: 'x' }, tokenLider);
  assert.strictEqual(r.status, 400);
  r = await json('GET', '/diagnostico', null, tokenLider);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.length, 2);

  console.log('→ diagnóstico: editar o texto e excluir um item');
  r = await json('PUT', `/diagnostico/${diagnosticoId}`, { texto: 'Alta rotatividade no turno da noite — priorizar' }, tokenLider);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  r = await json('DELETE', `/diagnostico/${diagnosticoId}`, null, tokenLider);
  assert.strictEqual(r.status, 204);
  r = await json('GET', '/diagnostico', null, tokenLider);
  assert.strictEqual(r.body.length, 1);

  console.log('→ excluir liderado remove também os registros do diário (cascade)');
  r = await json('DELETE', `/liderados/${liderado.id}`, null, tokenLider);
  assert.strictEqual(r.status, 204);
  r = await json('GET', '/diario/resumo-equipe', null, tokenLider);
  assert.strictEqual(r.body.length, 0);

  console.log('→ excluir turma solta o líder dela (não apaga) e limpa arquivo que ficou órfão');
  const turmaDescartavel = await json('POST', '/admin/turmas', { nome: 'Turma Descartável' }, tokenAdmin);
  const liderDescartavel = await json('POST', `/admin/turmas/${turmaDescartavel.body.id}/lideres`, { nome: 'Líder Descartável', email: 'descartavel@teste.com', senha: '123456' }, tokenAdmin);

  r = await json('DELETE', `/admin/turmas/${quartaTurma.body.id}`, null, tokenAdmin); // única turma do arquivoId2
  assert.strictEqual(r.status, 204, JSON.stringify(r.body));
  r = await json('DELETE', `/admin/turmas/${turmaDescartavel.body.id}`, null, tokenAdmin);
  assert.strictEqual(r.status, 204, JSON.stringify(r.body));

  r = await json('GET', '/admin/lideres', null, tokenAdmin);
  const liderDescartavelDepois = r.body.find(l => l.id === liderDescartavel.body.id);
  assert.strictEqual(liderDescartavelDepois.turma_id, null); // líder não foi apagado, só ficou sem turma
  r = await json('DELETE', `/admin/turmas/${turmaDescartavel.body.id}`, null, tokenAdmin);
  assert.strictEqual(r.status, 404); // já foi excluída, não existe mais

  server.close();
  console.log('\n✅ Todos os fluxos passaram.');
}

main().catch(err => {
  console.error('\n❌ Falhou:', err);
  process.exit(1);
});
