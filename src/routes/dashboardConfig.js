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
  const { rows } = await pool.query(
    `INSERT INTO dashboard_config (lider_id, ideal_operacional, ideal_tatico, ideal_estrategico, checklist_erros, checklist_lider)
     VALUES ($1, COALESCE($2,30), COALESCE($3,40), COALESCE($4,30), COALESCE($5,'{}'::jsonb), COALESCE($6,'{}'::jsonb))
     ON CONFLICT (lider_id) DO UPDATE SET
       ideal_operacional = COALESCE(EXCLUDED.ideal_operacional, dashboard_config.ideal_operacional),
       ideal_tatico = COALESCE(EXCLUDED.ideal_tatico, dashboard_config.ideal_tatico),
       ideal_estrategico = COALESCE(EXCLUDED.ideal_estrategico, dashboard_config.ideal_estrategico),
       checklist_erros = COALESCE(EXCLUDED.checklist_erros, dashboard_config.checklist_erros),
       checklist_lider = COALESCE(EXCLUDED.checklist_lider, dashboard_config.checklist_lider)
     RETURNING *`,
    [req.user.id, idealOperacional, idealTatico, idealEstrategico, checklistErros ? JSON.stringify(checklistErros) : null, checklistLider ? JSON.stringify(checklistLider) : null]
  );
  res.json(rows[0]);
});

module.exports = router;
