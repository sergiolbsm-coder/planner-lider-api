const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { pool } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

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
  const turma = await pool.query('SELECT id FROM turmas WHERE id = $1', [turmaId]);
  if (!turma.rows.length) return res.status(404).json({ erro: 'Turma não encontrada.' });

  const { nome, email, senha, area, cargo } = req.body || {};
  if (!nome || !email || !senha) return res.status(400).json({ erro: 'Informe nome, e-mail e senha.' });
  if (senha.length < 6) return res.status(400).json({ erro: 'A senha precisa ter pelo menos 6 caracteres.' });

  const emailNormalizado = String(email).trim().toLowerCase();
  const existente = await pool.query('SELECT id FROM users WHERE email = $1', [emailNormalizado]);
  if (existente.rows.length) return res.status(409).json({ erro: 'Já existe uma conta com este e-mail.' });

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

// Vincula TODOS os arquivos de uma pasta (dentro da turma de origem) a outra
// turma de uma vez — "copiar pasta pra outra turma".
router.post('/turmas/:turmaId/pastas/vincular', async (req, res) => {
  const { pasta, turmaDestinoId } = req.body || {};
  if (!turmaDestinoId) return res.status(400).json({ erro: 'Informe a turma de destino.' });
  const turmaDestino = await pool.query('SELECT id FROM turmas WHERE id = $1', [turmaDestinoId]);
  if (!turmaDestino.rows.length) return res.status(404).json({ erro: 'Turma de destino não encontrada.' });

  const { rows: arquivos } = await pool.query(
    `SELECT a.id FROM arquivos_aula a
     JOIN arquivo_turmas vt ON vt.arquivo_id = a.id AND vt.turma_id = $1
     WHERE ${pasta ? 'a.pasta = $2' : 'a.pasta IS NULL'}`,
    pasta ? [req.params.turmaId, pasta] : [req.params.turmaId]
  );

  for (const a of arquivos) {
    await pool.query('INSERT INTO arquivo_turmas (arquivo_id, turma_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [a.id, turmaDestinoId]);
  }
  res.json({ vinculados: arquivos.length });
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
