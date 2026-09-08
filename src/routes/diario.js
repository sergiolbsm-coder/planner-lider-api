const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireLider } = require('../middleware/auth');

const router = express.Router();

async function pertenceAoLider(liderado_id, lider_id) {
  const { rows } = await pool.query('SELECT id FROM users WHERE id = $1 AND lider_id = $2', [liderado_id, lider_id]);
  return rows.length > 0;
}

// Líder: todos os registros de um liderado específico (linha do tempo individual).
router.get('/liderado/:liderado_id', requireAuth, requireLider, async (req, res) => {
  if (!(await pertenceAoLider(req.params.liderado_id, req.user.id))) {
    return res.status(404).json({ erro: 'Liderado não encontrado.' });
  }
  const { rows } = await pool.query(
    'SELECT * FROM diario_registros WHERE liderado_id = $1 ORDER BY data DESC, criado_em DESC',
    [req.params.liderado_id]
  );
  res.json(rows);
});

// Líder: visão da equipe — o registro de risco/sinal/plano mais recente de cada liderado,
// mais o último feedback formal. Usado pra montar a tabela sem N chamadas.
router.get('/resumo-equipe', requireAuth, requireLider, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (liderado_id, tipo) *
     FROM diario_registros
     WHERE lider_id = $1
     ORDER BY liderado_id, tipo, data DESC, criado_em DESC`,
    [req.user.id]
  );
  res.json(rows);
});

// Líder: novo registro (observação ou feedback formal).
router.post('/', requireAuth, requireLider, async (req, res) => {
  const { liderado_id, tipo, data, riscos, sinais, conversa, plano } = req.body || {};
  if (!liderado_id || !data) return res.status(400).json({ erro: 'Informe o liderado e a data.' });
  if (!(await pertenceAoLider(liderado_id, req.user.id))) {
    return res.status(404).json({ erro: 'Liderado não encontrado.' });
  }
  const tipoFinal = tipo === 'feedback' ? 'feedback' : 'observacao';
  if (!(riscos && riscos.length) && !sinais && !conversa && !plano) {
    return res.status(400).json({ erro: 'Preencha ao menos um campo do registro.' });
  }

  const { rows } = await pool.query(
    `INSERT INTO diario_registros (lider_id, liderado_id, tipo, data, riscos, sinais, conversa, plano)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.user.id, liderado_id, tipoFinal, data, riscos || [], sinais || null, conversa || null, plano || null]
  );
  res.status(201).json(rows[0]);
});

router.delete('/:id', requireAuth, requireLider, async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM diario_registros WHERE id = $1 AND lider_id = $2', [req.params.id, req.user.id]);
  if (!rowCount) return res.status(404).json({ erro: 'Registro não encontrado.' });
  res.status(204).end();
});

// Liderado: só os feedbacks formais recebidos (nunca observações/riscos internos do líder).
router.get('/meus-feedbacks', requireAuth, async (req, res) => {
  if (req.user.role !== 'liderado') return res.status(403).json({ erro: 'Apenas contas de liderado usam esta rota.' });
  const { rows } = await pool.query(
    `SELECT id, data, conversa, plano, criado_em FROM diario_registros
     WHERE liderado_id = $1 AND tipo = 'feedback'
     ORDER BY data DESC`,
    [req.user.id]
  );
  res.json(rows);
});

module.exports = router;
