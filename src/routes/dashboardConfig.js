const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireLider } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, requireLider, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM dashboard_config WHERE lider_id = $1', [req.user.id]);
  if (rows.length) return res.json(rows[0]);

  const { rows: criado } = await pool.query(
    `INSERT INTO dashboard_config (lider_id) VALUES ($1) RETURNING *`,
    [req.user.id]
  );
  res.json(criado[0]);
});

router.put('/', requireAuth, requireLider, async (req, res) => {
  const { idealOperacional, idealTatico, idealEstrategico, checklistErros, checklistLider } = req.body || {};

  // Garante que a linha exista, sem mexer em nada se já existir — os valores
  // de fato são aplicados pelo UPDATE abaixo, com COALESCE contra a linha
  // já salva (nunca contra um "valor padrão" do INSERT, senão um PUT parcial
  // apagaria o campo que não foi enviado).
  await pool.query(`INSERT INTO dashboard_config (lider_id) VALUES ($1) ON CONFLICT (lider_id) DO NOTHING`, [req.user.id]);

  const { rows } = await pool.query(
    `UPDATE dashboard_config SET
       ideal_operacional = COALESCE($2, ideal_operacional),
       ideal_tatico = COALESCE($3, ideal_tatico),
       ideal_estrategico = COALESCE($4, ideal_estrategico),
       checklist_erros = COALESCE($5, checklist_erros),
       checklist_lider = COALESCE($6, checklist_lider)
     WHERE lider_id = $1
     RETURNING *`,
    [
      req.user.id, idealOperacional, idealTatico, idealEstrategico,
      checklistErros ? JSON.stringify(checklistErros) : null,
      checklistLider ? JSON.stringify(checklistLider) : null,
    ]
  );
  res.json(rows[0]);
});

module.exports = router;
