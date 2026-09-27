const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const SELECT_METADADOS = 'a.id, a.nome, a.descricao, a.pasta, a.tipo_mime, a.tamanho_bytes, a.criado_em';

// Upload/edição/exclusão/vínculo agora são só do administrador — ver
// src/routes/admin.js. Aqui líder e liderado só leem os arquivos vinculados à
// turma do seu líder (um arquivo pode estar vinculado a mais de uma turma):
// req.user.liderId resolve pro próprio id (se for líder) ou pro id do líder
// dele (se for liderado) — por isso a mesma query serve os dois papéis.
const LISTAR = `
  SELECT DISTINCT ${SELECT_METADADOS} FROM arquivos_aula a
  JOIN arquivo_turmas vt ON vt.arquivo_id = a.id
  JOIN users lider ON lider.id = $1 AND lider.turma_id = vt.turma_id
  ORDER BY a.criado_em DESC
`;

router.get('/', requireAuth, async (req, res) => {
  const { rows } = await pool.query(LISTAR, [req.user.liderId]);
  res.json(rows);
});

router.get('/minha-turma', requireAuth, async (req, res) => {
  const { rows } = await pool.query(LISTAR, [req.user.liderId]);
  res.json(rows);
});

router.get('/:id/download', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT DISTINCT a.nome, a.tipo_mime, a.conteudo FROM arquivos_aula a
     JOIN arquivo_turmas vt ON vt.arquivo_id = a.id
     JOIN users lider ON lider.id = $2 AND lider.turma_id = vt.turma_id
     WHERE a.id = $1`,
    [req.params.id, req.user.liderId]
  );
  if (!rows.length) return res.status(404).json({ erro: 'Arquivo não encontrado.' });

  const arquivo = rows[0];
  res.setHeader('Content-Type', arquivo.tipo_mime);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(arquivo.nome)}"`);
  res.send(arquivo.conteudo);
});

module.exports = router;
