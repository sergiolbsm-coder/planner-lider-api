const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireLider } = require('../middleware/auth');

const router = express.Router();

// Todos os registros (o dashboard calcula a distribuição sobre o histórico completo).
router.get('/', requireAuth, requireLider, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM rotina_registros WHERE lider_id = $1 ORDER BY data DESC, inicio ASC', [req.user.id]);
  res.json(rows);
});

router.post('/', requireAuth, requireLider, async (req, res) => {
  const { data, inicio, fim, atividade, tipo, impacto, energia } = req.body || {};
  if (!data || !inicio || !fim || !atividade || !tipo) {
    return res.status(400).json({ erro: 'Preencha data, horários, atividade e tipo.' });
  }
  if (fim <= inicio) return res.status(400).json({ erro: 'O horário de fim deve ser depois do início.' });

  const { rows } = await pool.query(
    `INSERT INTO rotina_registros (lider_id, data, inicio, fim, atividade, tipo, impacto, energia)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.user.id, data, inicio, fim, atividade.trim(), tipo, impacto || null, energia || null]
  );
  res.status(201).json(rows[0]);
});

router.delete('/:id', requireAuth, requireLider, async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM rotina_registros WHERE id = $1 AND lider_id = $2', [req.params.id, req.user.id]);
  if (!rowCount) return res.status(404).json({ erro: 'Registro não encontrado.' });
  res.status(204).end();
});

module.exports = router;
