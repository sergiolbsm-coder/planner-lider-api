const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireLider } = require('../middleware/auth');

const router = express.Router();

const MES_REF_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

// Lista o histórico de autoavaliações do líder (mais recente primeiro).
router.get('/', requireAuth, requireLider, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM autoavaliacoes WHERE lider_id = $1 ORDER BY mes_ref DESC',
    [req.user.id]
  );
  res.json(rows);
});

// Autoavaliação de um mês específico (ou respostas vazias se ainda não existir).
router.get('/:mesRef', requireAuth, requireLider, async (req, res) => {
  if (!MES_REF_REGEX.test(req.params.mesRef)) return res.status(400).json({ erro: 'Mês inválido, use o formato AAAA-MM.' });
  const { rows } = await pool.query(
    'SELECT * FROM autoavaliacoes WHERE lider_id = $1 AND mes_ref = $2',
    [req.user.id, req.params.mesRef]
  );
  res.json(rows[0] || { lider_id: req.user.id, mes_ref: req.params.mesRef, respostas: {} });
});

// Upsert das respostas de um mês.
router.put('/:mesRef', requireAuth, requireLider, async (req, res) => {
  if (!MES_REF_REGEX.test(req.params.mesRef)) return res.status(400).json({ erro: 'Mês inválido, use o formato AAAA-MM.' });
  const { respostas } = req.body || {};
  if (!respostas || typeof respostas !== 'object') return res.status(400).json({ erro: 'Informe as respostas.' });

  const { rows } = await pool.query(
    `INSERT INTO autoavaliacoes (lider_id, mes_ref, respostas)
     VALUES ($1, $2, $3)
     ON CONFLICT (lider_id, mes_ref) DO UPDATE SET
       respostas = $3,
       atualizado_em = now()
     RETURNING *`,
    [req.user.id, req.params.mesRef, JSON.stringify(respostas)]
  );
  res.json(rows[0]);
});

module.exports = router;
