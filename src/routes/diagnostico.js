const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireLider } = require('../middleware/auth');

const router = express.Router();

const TIPOS = ['desafio', 'oportunidade'];

// Líder: lista o brainstorm de Desafios e Oportunidades.
router.get('/', requireAuth, requireLider, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM diagnostico_itens WHERE lider_id = $1 ORDER BY tipo ASC, ordem ASC, criado_em ASC',
    [req.user.id]
  );
  res.json(rows);
});

router.post('/', requireAuth, requireLider, async (req, res) => {
  const { tipo, texto, ordem } = req.body || {};
  if (!TIPOS.includes(tipo)) return res.status(400).json({ erro: 'Tipo inválido — use "desafio" ou "oportunidade".' });
  if (!texto || !texto.trim()) return res.status(400).json({ erro: 'Descreva o item.' });

  const { rows } = await pool.query(
    `INSERT INTO diagnostico_itens (lider_id, tipo, texto, ordem) VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.user.id, tipo, texto.trim(), Number.isInteger(ordem) ? ordem : 0]
  );
  res.status(201).json(rows[0]);
});

router.put('/:id', requireAuth, requireLider, async (req, res) => {
  const { texto, ordem } = req.body || {};
  const { rows } = await pool.query(
    `UPDATE diagnostico_itens SET texto = COALESCE($1, texto), ordem = COALESCE($2, ordem)
     WHERE id = $3 AND lider_id = $4
     RETURNING *`,
    [texto, ordem, req.params.id, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ erro: 'Item não encontrado.' });
  res.json(rows[0]);
});

router.delete('/:id', requireAuth, requireLider, async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM diagnostico_itens WHERE id = $1 AND lider_id = $2', [req.params.id, req.user.id]);
  if (!rowCount) return res.status(404).json({ erro: 'Item não encontrado.' });
  res.status(204).end();
});

module.exports = router;
