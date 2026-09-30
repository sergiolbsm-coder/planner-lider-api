const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { pool } = require('../db');
const { requireAuth, requireAdmin, assinarToken } = require('../middleware/auth');
const { enviarConviteLider } = require('../mail');

const router = express.Router();
router.use(requireAuth, requireAdmin);

const LIMITE_TAMANHO_ARQUIVO = 20 * 1024 * 1024; // 20MB — dá pra maioria de PDFs/slides de aula
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: LIMITE_TAMANHO_ARQUIVO } });

// Plano de Ação sugerido pra todo líder novo começar com algo em vez de uma
// tabela vazia — o líder edita/remove como quiser depois.
const PLANO_ACAO_PADRAO = [
  { acao: 'Bloquear tempo para o estratégico', como_fazer: 'Agendar 2 blocos diários sem interrupções.', impacto: 'Mais foco em projetos e desenvolvimento.', prazo: 'Imediato' },
  { acao: 'Delegar com clareza', como_fazer: 'Definir responsáveis e acompanhar resultados.', impacto: 'Reduzir sobrecarga operacional.', prazo: 'Imediato' },
  { acao: 'Padronizar processos', como_fazer: 'Criar checklists e templates para demandas recorrentes.', impacto: 'Menos retrabalho e mais eficiência.', prazo: 'Curto prazo (30 dias)' },
  { acao: 'Reuniões com propósito', como_fazer: 'Pauta clara, objetivo e tempo definido.', impacto: 'Reuniões mais eficazes e rápidas.', prazo: 'Curto prazo (30 dias)' },
  { acao: 'Acompanhar indicadores', como_fazer: 'Focar no que realmente importa.', impacto: 'Decisões melhores e mais rápidas.', prazo: 'Contínuo' },
  { acao: 'Desenvolver pessoas', como_fazer: '1:1s semanais e feedback estruturado.', impacto: 'Equipe mais engajada e preparada.', prazo: 'Contínuo' },
];

// ---- Turmas ----
router.get('/turmas', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM turmas ORDER BY criado_em ASC');
  res.json(rows);
});

router.post('/turmas', async (req, res) => {
  const { nome } = req.body || {};
  if (!nome || !nome.trim()) return res.status(400).json({ erro: 'Dê um nome à turma.' });
  const { rows } = await pool.query('INSERT INTO turmas (nome) VALUES ($1) RETURNING *', [nome.trim()]);
  res.status(201).json(rows[0]);
});

router.put('/turmas/:id', async (req, res) => {
  const { nome } = req.body || {};
  if (!nome || !nome.trim()) return res.status(400).json({ erro: 'Dê um nome à turma.' });
  const { rows } = await pool.query('UPDATE turmas SET nome = $1 WHERE id = $2 RETURNING *', [nome.trim(), req.params.id]);
  if (!rows.length) return res.status(404).json({ erro: 'Turma não encontrada.' });
  res.json(rows[0]);
});

// Excluir a turma solta os líderes dela (viram "sem turma", não são apagados
// — cascade de users.turma_id é ON DELETE SET NULL) e apaga a trilha de
// desafios da turma (cascade). Arquivos que ficarem sem nenhuma turma
// vinculada (porque só estavam nesta) também são limpos, senão viram lixo
// órfão pra sempre no banco.
router.delete('/turmas/:id', async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM turmas WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ erro: 'Turma não encontrada.' });
  await pool.query('DELETE FROM arquivos_aula WHERE id NOT IN (SELECT arquivo_id FROM arquivo_turmas)');
  res.status(204).end();
});

// ---- Líderes ----
// Todos os líderes, com a turma de cada um — usado pra reatribuir líderes
// antigos (de antes de turmas existirem) a uma turma.
router.get('/lideres', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, nome, email, area, cargo, turma_id, criado_em FROM users WHERE role = 'lider' ORDER BY criado_em ASC`
  );
  res.json(rows);
});

router.get('/turmas/:turmaId/lideres', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, nome, email, area, cargo, turma_id, criado_em FROM users WHERE role = 'lider' AND turma_id = $1 ORDER BY criado_em ASC`,
    [req.params.turmaId]
  );
  res.json(rows);
});

// Admin cadastra um líder já dentro de uma turma (o líder não se autocadastra mais).
router.post('/turmas/:turmaId/lideres', async (req, res) => {
  const { turmaId } = req.params;
  const turma = await pool.query('SELECT id, nome FROM turmas WHERE id = $1', [turmaId]);
  if (!turma.rows.length) return res.status(404).json({ erro: 'Turma não encontrada.' });

  const { nome, email, senha, area, cargo } = req.body || {};
  if (!nome || !email || !senha) return res.status(400).json({ erro: 'Informe nome, e-mail e senha.' });
  if (senha.length < 6) return res.status(400).json({ erro: 'A senha precisa ter pelo menos 6 caracteres.' });

  // Checa duplicidade só DENTRO desta turma — a mesma pessoa (mesmo e-mail)
  // pode ser líder em outra turma, ou até ser o próprio administrador usando
  // o mesmo e-mail como conta de teste (ver unique index em schema.sql).
  const emailNormalizado = String(email).trim().toLowerCase();
  const existente = await pool.query(
    'SELECT id FROM users WHERE email = $1 AND role = $2 AND turma_id = $3',
    [emailNormalizado, 'lider', turmaId]
  );
  if (existente.rows.length) return res.status(409).json({ erro: 'Este e-mail já é líder nesta turma.' });

  const senhaHash = await bcrypt.hash(senha, 10);
  const { rows } = await pool.query(
    `INSERT INTO users (role, nome, email, senha_hash, area, cargo, turma_id)
     VALUES ('lider', $1, $2, $3, $4, $5, $6)
     RETURNING id, nome, email, area, cargo, turma_id, criado_em`,
    [nome.trim(), emailNormalizado, senhaHash, area || null, cargo || null, turmaId]
  );
  const novoLider = rows[0];

  for (const item of PLANO_ACAO_PADRAO) {
    await pool.query(
      `INSERT INTO plano_acao_itens (lider_id, acao, como_fazer, impacto, prazo, ordem) VALUES ($1,$2,$3,$4,$5,$6)`,
      [novoLider.id, item.acao, item.como_fazer, item.impacto, item.prazo, 0]
    );
  }

  // O líder já foi criado no banco — se o e-mail falhar, o cadastro segue
  // válido mesmo assim (admin ainda pode passar a senha por outro canal).
  try {
    await enviarConviteLider({ nome: novoLider.nome, email: novoLider.email, senha, turmaNome: turma.rows[0].nome });
  } catch (err) {
    console.error('Falha ao enviar e-mail de convite para', novoLider.email, err);
  }

  res.status(201).json(novoLider);
});

// Move um líder pra outra turma (ex: líder cadastrado antes de turmas existirem).
router.put('/lideres/:id', async (req, res) => {
  const { turmaId } = req.body || {};
  if (!turmaId) return res.status(400).json({ erro: 'Informe a turma.' });
  const turma = await pool.query('SELECT id FROM turmas WHERE id = $1', [turmaId]);
  if (!turma.rows.length) return res.status(404).json({ erro: 'Turma não encontrada.' });

  const { rows } = await pool.query(
    `UPDATE users SET turma_id = $1 WHERE id = $2 AND role = 'lider'
     RETURNING id, nome, email, area, cargo, turma_id, criado_em`,
    [turmaId, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ erro: 'Líder não encontrado.' });
  res.json(rows[0]);
});

// Redefine a senha de um líder já cadastrado — usado quando ele esquece a
// senha ou o admin quer trocar o acesso; não exige a senha antiga porque
// quem chama essa rota já é o administrador autenticado.
router.put('/lideres/:id/senha', async (req, res) => {
  const { senha } = req.body || {};
  if (!senha || senha.length < 6) return res.status(400).json({ erro: 'A senha precisa ter pelo menos 6 caracteres.' });

  const senhaHash = await bcrypt.hash(senha, 10);
  const { rows } = await pool.query(
    `UPDATE users SET senha_hash = $1 WHERE id = $2 AND role = 'lider' RETURNING id`,
    [senhaHash, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ erro: 'Líder não encontrado.' });
  res.status(204).end();
});

// "Visualizar como" — o admin confere o que o líder já preencheu sem
// precisar da senha dele. Emite um token de verdade pro painel do líder
// (reaproveita a tela inteira), mas marcado somenteLeitura e de vida curta:
// requireAuth bloqueia qualquer POST/PUT/DELETE feito com ele, então não tem
// como o admin escrever por engano nos dados do líder enquanto olha.
router.post('/lideres/:id/visualizar', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, role, nome, email, area, cargo, turma_id FROM users WHERE id = $1 AND role = 'lider'`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ erro: 'Líder não encontrado.' });
  const lider = rows[0];
  const token = assinarToken(lider, { somenteLeitura: true, expiresIn: '20m' });
  res.json({ token, user: { id: lider.id, role: lider.role, nome: lider.nome, email: lider.email, area: lider.area, cargo: lider.cargo, turmaId: lider.turma_id, somenteLeitura: true } });
});

// ---- Trilha de Desafios da turma (template — só o admin edita) ----
router.get('/turmas/:turmaId/desafios', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM desafios_itens WHERE turma_id = $1 ORDER BY ordem ASC, criado_em ASC',
    [req.params.turmaId]
  );
  res.json(rows);
});

router.post('/turmas/:turmaId/desafios', async (req, res) => {
  const { turmaId } = req.params;
  const turma = await pool.query('SELECT id FROM turmas WHERE id = $1', [turmaId]);
  if (!turma.rows.length) return res.status(404).json({ erro: 'Turma não encontrada.' });

  const { titulo, descricao, secaoAlvo, prazo, pontos, ordem } = req.body || {};
  if (!titulo || !titulo.trim()) return res.status(400).json({ erro: 'Dê um título ao desafio.' });

  const { rows } = await pool.query(
    `INSERT INTO desafios_itens (turma_id, titulo, descricao, secao_alvo, prazo, pontos, ordem)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [turmaId, titulo.trim(), descricao || null, secaoAlvo || null, prazo || null, Number.isInteger(pontos) ? pontos : 10, Number.isInteger(ordem) ? ordem : 0]
  );
  res.status(201).json(rows[0]);
});

// secaoAlvo e prazo usam presença da chave no body (não COALESCE) porque
// "limpar" os dois é um valor válido (null) — ver mesma nota em desafios.js.
router.put('/desafios/:id', async (req, res) => {
  const body = req.body || {};
  const { titulo, descricao, pontos, ordem } = body;
  const temSecao = Object.prototype.hasOwnProperty.call(body, 'secaoAlvo');
  const temPrazo = Object.prototype.hasOwnProperty.call(body, 'prazo');

  const { rows } = await pool.query(
    `UPDATE desafios_itens SET
       titulo = COALESCE($1, titulo),
       descricao = COALESCE($2, descricao),
       secao_alvo = CASE WHEN $3 THEN $4 ELSE secao_alvo END,
       prazo = CASE WHEN $5 THEN $6 ELSE prazo END,
       pontos = COALESCE($7, pontos),
       ordem = COALESCE($8, ordem)
     WHERE id = $9
     RETURNING *`,
    [titulo, descricao, temSecao, body.secaoAlvo || null, temPrazo, body.prazo || null, pontos, ordem, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ erro: 'Desafio não encontrado.' });
  res.json(rows[0]);
});

router.delete('/desafios/:id', async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM desafios_itens WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ erro: 'Desafio não encontrado.' });
  res.status(204).end();
});

// ---- Arquivos da Aula (upload/edição/vínculo — só o admin) ----
// Um arquivo pode estar vinculado a mais de uma turma (arquivo_turmas, N:N) —
// editar/excluir e o próprio conteúdo são únicos por arquivo; o que muda por
// turma é só quais arquivos aparecem pra ela.
const SELECT_ARQUIVO_METADADOS = 'a.id, a.nome, a.descricao, a.pasta, a.tipo_mime, a.tamanho_bytes, a.criado_em';

router.get('/turmas/:turmaId/arquivos', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ${SELECT_ARQUIVO_METADADOS} FROM arquivos_aula a
     JOIN arquivo_turmas vt ON vt.arquivo_id = a.id AND vt.turma_id = $1
     ORDER BY a.criado_em DESC`,
    [req.params.turmaId]
  );
  res.json(rows);
});

router.post('/turmas/:turmaId/arquivos', upload.single('arquivo'), async (req, res) => {
  const { turmaId } = req.params;
  const turma = await pool.query('SELECT id FROM turmas WHERE id = $1', [turmaId]);
  if (!turma.rows.length) return res.status(404).json({ erro: 'Turma não encontrada.' });
  if (!req.file) return res.status(400).json({ erro: 'Selecione um arquivo.' });

  const nome = (req.body.nome || req.file.originalname || 'arquivo').trim();
  const descricao = (req.body.descricao || '').trim() || null;
  const pasta = (req.body.pasta || '').trim() || null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO arquivos_aula (nome, descricao, pasta, tipo_mime, tamanho_bytes, conteudo)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, nome, descricao, pasta, tipo_mime, tamanho_bytes, criado_em`,
      [nome, descricao, pasta, req.file.mimetype || 'application/octet-stream', req.file.size, req.file.buffer]
    );
    await client.query('INSERT INTO arquivo_turmas (arquivo_id, turma_id) VALUES ($1,$2)', [rows[0].id, turmaId]);
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// Renomeia, move de pasta ou edita a descrição (não troca o conteúdo — pra
// isso é excluir e subir de novo). Afeta todas as turmas vinculadas ao mesmo
// arquivo, já que é o mesmo conteúdo. O front sempre manda os 3 campos
// juntos, então é um UPDATE direto, sem COALESCE.
router.put('/arquivos/:id', async (req, res) => {
  const nome = (req.body.nome || '').trim();
  if (!nome) return res.status(400).json({ erro: 'Dê um nome ao arquivo.' });
  const descricao = (req.body.descricao || '').trim() || null;
  const pasta = (req.body.pasta || '').trim() || null;

  const { rows } = await pool.query(
    `UPDATE arquivos_aula SET nome = $1, descricao = $2, pasta = $3
     WHERE id = $4
     RETURNING id, nome, descricao, pasta, tipo_mime, tamanho_bytes, criado_em`,
    [nome, descricao, pasta, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ erro: 'Arquivo não encontrado.' });
  res.json(rows[0]);
});

// Vincula um arquivo já existente a outra turma — é o "copiar" e o "vincular
// em mais de uma turma" ao mesmo tempo: mesmo conteúdo, sem duplicar bytea.
router.post('/arquivos/:id/vincular', async (req, res) => {
  const { turmaId } = req.body || {};
  if (!turmaId) return res.status(400).json({ erro: 'Informe a turma de destino.' });
  const arquivo = await pool.query('SELECT id FROM arquivos_aula WHERE id = $1', [req.params.id]);
  if (!arquivo.rows.length) return res.status(404).json({ erro: 'Arquivo não encontrado.' });
  const turma = await pool.query('SELECT id FROM turmas WHERE id = $1', [turmaId]);
  if (!turma.rows.length) return res.status(404).json({ erro: 'Turma de destino não encontrada.' });

  await pool.query(
    'INSERT INTO arquivo_turmas (arquivo_id, turma_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [req.params.id, turmaId]
  );
  res.status(204).end();
});

// Busca os ids dos arquivos de uma pasta (ou "sem pasta", se pasta for vazio)
// que estão vinculados a uma turma específica — usado tanto por "vincular
// pasta" quanto por "transferir pasta".
async function arquivosDaPasta(turmaId, pasta) {
  const { rows } = await pool.query(
    `SELECT a.id FROM arquivos_aula a
     JOIN arquivo_turmas vt ON vt.arquivo_id = a.id AND vt.turma_id = $1
     WHERE ${pasta ? 'a.pasta = $2' : 'a.pasta IS NULL'}`,
    pasta ? [turmaId, pasta] : [turmaId]
  );
  return rows;
}

async function validarTurmaDestino(turmaId, turmaDestinoId) {
  if (!turmaDestinoId) return 'Informe a turma de destino.';
  if (turmaDestinoId === turmaId) return 'Escolha uma turma diferente da atual.';
  const turma = await pool.query('SELECT id FROM turmas WHERE id = $1', [turmaDestinoId]);
  if (!turma.rows.length) return 'Turma de destino não encontrada.';
  return null;
}

// Vincula TODOS os arquivos de uma pasta (dentro da turma de origem) a outra
// turma de uma vez — "copiar pasta pra outra turma". O arquivo continua
// disponível na turma de origem também.
router.post('/turmas/:turmaId/pastas/vincular', async (req, res) => {
  const { pasta, turmaDestinoId } = req.body || {};
  const erro = await validarTurmaDestino(req.params.turmaId, turmaDestinoId);
  if (erro) return res.status(erro === 'Informe a turma de destino.' ? 400 : 404).json({ erro });

  const arquivos = await arquivosDaPasta(req.params.turmaId, pasta);
  for (const a of arquivos) {
    await pool.query('INSERT INTO arquivo_turmas (arquivo_id, turma_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [a.id, turmaDestinoId]);
  }
  res.json({ vinculados: arquivos.length });
});

// Transfere a pasta inteira pra outra turma — na prática igual a "vincular
// pasta" (fica uma cópia na turma de origem e outra na de destino); mantido
// como rota/verbo separado porque no fluxo do admin faz sentido distinguir
// "estou expandindo o uso desse material" (vincular) de "estou levando essa
// pasta pra outra turma" (transferir), mesmo o resultado sendo o mesmo hoje.
router.post('/turmas/:turmaId/pastas/transferir', async (req, res) => {
  const { pasta, turmaDestinoId } = req.body || {};
  const erro = await validarTurmaDestino(req.params.turmaId, turmaDestinoId);
  if (erro) return res.status(erro === 'Informe a turma de destino.' || erro === 'Escolha uma turma diferente da atual.' ? 400 : 404).json({ erro });

  const arquivos = await arquivosDaPasta(req.params.turmaId, pasta);
  for (const a of arquivos) {
    await pool.query('INSERT INTO arquivo_turmas (arquivo_id, turma_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [a.id, turmaDestinoId]);
  }
  res.json({ transferidos: arquivos.length });
});

// Remove o arquivo desta turma. Se não sobrar nenhuma outra turma vinculada,
// apaga o arquivo de vez (senão ficaria lixo órfão pra sempre no banco).
router.delete('/turmas/:turmaId/arquivos/:id', async (req, res) => {
  const { rowCount } = await pool.query(
    'DELETE FROM arquivo_turmas WHERE arquivo_id = $1 AND turma_id = $2',
    [req.params.id, req.params.turmaId]
  );
  if (!rowCount) return res.status(404).json({ erro: 'Arquivo não encontrado nesta turma.' });

  const restante = await pool.query('SELECT 1 FROM arquivo_turmas WHERE arquivo_id = $1 LIMIT 1', [req.params.id]);
  if (!restante.rows.length) {
    await pool.query('DELETE FROM arquivos_aula WHERE id = $1', [req.params.id]);
  }
  res.status(204).end();
});

// Erros do multer (ex: arquivo grande demais) viram JSON, não o handler de erro genérico do HTML.
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Arquivo maior que o limite de 20MB.' : err.message;
    return res.status(400).json({ erro: msg });
  }
  next(err);
});

module.exports = router;
