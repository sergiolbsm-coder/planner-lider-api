const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireLider } = require('../middleware/auth');

const router = express.Router();

// Líder: lista todas as metas do workspace, com progresso calculado.
router.get('/', requireAuth, requireLider, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT m.id, m.lider_id, m.nome, m.tipo, m.indicador, m.valor, m.prazo, m.descricao, m.criado_em,
            COUNT(a.id) FILTER (WHERE a.meta_id = m.id) AS total_atividades,
            COUNT(a.id) FILTER (WHERE a.meta_id = m.id AND a.status = 'concluido') AS atividades_concluidas
     FROM metas m
     LEFT JOIN atividades a ON a.meta_id = m.id
     WHERE m.lider_id = $1
     GROUP BY m.id
     ORDER BY m.criado_em ASC`,
    [req.user.id]
  );
  res.json(rows);
});

// Liderado: metas vinculadas às atividades dele + a meta em texto livre do próprio perfil.
router.get('/minhas', requireAuth, async (req, res) => {
  if (req.user.role !== 'liderado') return res.status(403).json({ erro: 'Apenas contas de liderado usam esta rota.' });
  const { rows } = await pool.query(
    `SELECT DISTINCT m.*
     FROM metas m
     JOIN atividades a ON a.meta_id = m.id
     WHERE a.responsavel_id = $1
     ORDER BY m.criado_em ASC`,
    [req.user.id]
  );
  res.json(rows);
});

router.post('/', requireAuth, requireLider, async (req, res) => {
  const { nome, tipo, indicador, valor, prazo, descricao } = req.body || {};
  if (!nome || !tipo) return res.status(400).json({ erro: 'Informe nome e categoria da meta.' });
  if (!['estrategico', 'tatico', 'operacional'].includes(tipo)) {
    return res.status(400).json({ erro: 'Categoria inválida.' });
  }

  const { rows } = await pool.query(
    `INSERT INTO metas (lider_id, nome, tipo, indicador, valor, prazo, descricao)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [req.user.id, nome.trim(), tipo, indicador || null, valor || null, prazo || null, descricao || null]
  );
  res.status(201).json(rows[0]);
});

router.put('/:id', requireAuth, requireLider, async (req, res) => {
  const { nome, tipo, indicador, valor, prazo, descricao } = req.body || {};
  const { rows } = await pool.query(
    `UPDATE metas SET
       nome = COALESCE($1, nome), tipo = COALESCE($2, tipo), indicador = COALESCE($3, indicador),
       valor = COALESCE($4, valor), prazo = COALESCE($5, prazo), descricao = COALESCE($6, descricao)
     WHERE id = $7 AND lider_id = $8 RETURNING *`,
    [nome, tipo, indicador, valor, prazo, descricao, req.params.id, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ erro: 'Meta não encontrada.' });
  res.json(rows[0]);
});

router.delete('/:id', requireAuth, requireLider, async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM metas WHERE id = $1 AND lider_id = $2', [req.params.id, req.user.id]);
  if (!rowCount) return res.status(404).json({ erro: 'Meta não encontrada.' });
  res.status(204).end();
});

module.exports = router;
