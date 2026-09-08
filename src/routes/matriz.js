const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireLider } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, requireLider, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM matriz_itens WHERE lider_id = $1 ORDER BY criado_em ASC', [req.user.id]);
  res.json(rows);
});

router.post('/', requireAuth, requireLider, async (req, res) => {
  const { titulo, resultado, esforco, obs } = req.body || {};
  if (!titulo || !resultado || !esforco) return res.status(400).json({ erro: 'Informe título, resultado e esforço.' });
  const { rows } = await pool.query(
    `INSERT INTO matriz_itens (lider_id, titulo, resultado, esforco, obs) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.user.id, titulo.trim(), resultado, esforco, obs || null]
  );
  res.status(201).json(rows[0]);
});

router.put('/:id', requireAuth, requireLider, async (req, res) => {
  const { titulo, resultado, esforco, obs } = req.body || {};
  const { rows } = await pool.query(
    `UPDATE matriz_itens SET titulo = COALESCE($1, titulo), resultado = COALESCE($2, resultado),
       esforco = COALESCE($3, esforco), obs = COALESCE($4, obs)
     WHERE id = $5 AND lider_id = $6 RETURNING *`,
    [titulo, resultado, esforco, obs, req.params.id, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ erro: 'Item não encontrado.' });
  res.json(rows[0]);
});

router.delete('/:id', requireAuth, requireLider, async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM matriz_itens WHERE id = $1 AND lider_id = $2', [req.params.id, req.user.id]);
  if (!rowCount) return res.status(404).json({ erro: 'Item não encontrado.' });
  res.status(204).end();
});

module.exports = router;
