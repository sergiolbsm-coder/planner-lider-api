const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireLider } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, requireLider, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM plano_acao_itens WHERE lider_id = $1 ORDER BY ordem ASC', [req.user.id]);
  res.json(rows);
});

router.post('/', requireAuth, requireLider, async (req, res) => {
  const { acao, comoFazer, impacto, prazo, ordem } = req.body || {};
  const { rows } = await pool.query(
    `INSERT INTO plano_acao_itens (lider_id, acao, como_fazer, impacto, prazo, ordem) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.user.id, acao || null, comoFazer || null, impacto || null, prazo || null, ordem || 0]
  );
  res.status(201).json(rows[0]);
});

router.put('/:id', requireAuth, requireLider, async (req, res) => {
  const { acao, comoFazer, impacto, prazo } = req.body || {};
  const { rows } = await pool.query(
    `UPDATE plano_acao_itens SET acao = $1, como_fazer = $2, impacto = $3, prazo = $4
     WHERE id = $5 AND lider_id = $6 RETURNING *`,
    [acao || null, comoFazer || null, impacto || null, prazo || null, req.params.id, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ erro: 'Ação não encontrada.' });
  res.json(rows[0]);
});

router.delete('/:id', requireAuth, requireLider, async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM plano_acao_itens WHERE id = $1 AND lider_id = $2', [req.params.id, req.user.id]);
  if (!rowCount) return res.status(404).json({ erro: 'Ação não encontrada.' });
  res.status(204).end();
});

module.exports = router;
