const express = require('express');
const multer = require('multer');
const { pool } = require('../db');
const { requireAuth, requireLider } = require('../middleware/auth');

const router = express.Router();

const LIMITE_TAMANHO = 20 * 1024 * 1024; // 20MB — dá pra maioria de PDFs/slides de aula
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: LIMITE_TAMANHO } });

const SELECT_METADADOS = 'id, lider_id, nome, descricao, tipo_mime, tamanho_bytes, criado_em';

// Líder: lista os arquivos que ele mesmo subiu (sem o conteúdo, só metadados).
router.get('/', requireAuth, requireLider, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ${SELECT_METADADOS} FROM arquivos_aula WHERE lider_id = $1 ORDER BY criado_em DESC`,
    [req.user.id]
  );
  res.json(rows);
});

// Liderado: lista os arquivos que o próprio líder disponibilizou pra turma.
router.get('/minha-turma', requireAuth, async (req, res) => {
  if (req.user.role !== 'liderado') return res.status(403).json({ erro: 'Apenas contas de liderado usam esta rota.' });
  const { rows } = await pool.query(
    `SELECT ${SELECT_METADADOS} FROM arquivos_aula WHERE lider_id = $1 ORDER BY criado_em DESC`,
    [req.user.liderId]
  );
  res.json(rows);
});

// Líder: sobe um arquivo (multipart/form-data, campo "arquivo").
router.post('/', requireAuth, requireLider, upload.single('arquivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ erro: 'Selecione um arquivo.' });
  const nome = (req.body.nome || req.file.originalname || 'arquivo').trim();
  const descricao = (req.body.descricao || '').trim() || null;

  const { rows } = await pool.query(
    `INSERT INTO arquivos_aula (lider_id, nome, descricao, tipo_mime, tamanho_bytes, conteudo)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING ${SELECT_METADADOS}`,
    [req.user.id, nome, descricao, req.file.mimetype || 'application/octet-stream', req.file.size, req.file.buffer]
  );
  res.status(201).json(rows[0]);
});

// Líder ou liderado (da mesma turma): baixa o conteúdo do arquivo.
// req.user.liderId já resolve pro id certo nos dois papéis (o próprio, se for
// líder; o do seu líder, se for liderado) — por isso a checagem é uma só.
router.get('/:id/download', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT nome, tipo_mime, conteudo FROM arquivos_aula WHERE id = $1 AND lider_id = $2',
    [req.params.id, req.user.liderId]
  );
  if (!rows.length) return res.status(404).json({ erro: 'Arquivo não encontrado.' });

  const arquivo = rows[0];
  res.setHeader('Content-Type', arquivo.tipo_mime);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(arquivo.nome)}"`);
  res.send(arquivo.conteudo);
});

router.delete('/:id', requireAuth, requireLider, async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM arquivos_aula WHERE id = $1 AND lider_id = $2', [req.params.id, req.user.id]);
  if (!rowCount) return res.status(404).json({ erro: 'Arquivo não encontrado.' });
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
