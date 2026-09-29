const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireLider } = require('../middleware/auth');

const router = express.Router();

async function validarMeta(metaId, liderId) {
  if (!metaId) return null;
  const { rows } = await pool.query('SELECT id FROM metas WHERE id = $1 AND lider_id = $2', [metaId, liderId]);
  if (!rows.length) throw Object.assign(new Error('Meta inválida.'), { status: 400 });
  return metaId;
}

router.get('/', requireAuth, requireLider, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM projetos_iniciativas WHERE lider_id = $1 ORDER BY ordem ASC', [req.user.id]);
  res.json(rows);
});

router.post('/', requireAuth, requireLider, async (req, res) => {
  const { nome, metaId, equipeAreas, recursos, checkpoints, ordem } = req.body || {};
  try {
    const meta_id = await validarMeta(metaId, req.user.id);
    const { rows } = await pool.query(
      `INSERT INTO projetos_iniciativas (lider_id, nome, meta_id, equipe_areas, recursos, checkpoints, ordem)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.id, nome || null, meta_id, equipeAreas || null, recursos || null, checkpoints || null, ordem || 0]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ erro: err.message });
    throw err;
  }
});

// PUT parcial via COALESCE — metaId usa hasOwnProperty porque limpar o
// vínculo é uma ação válida, diferente de "campo omitido" (mesmo padrão de
// plano_acao_itens/atividades).
router.put('/:id', requireAuth, requireLider, async (req, res) => {
  const dono = await pool.query('SELECT * FROM projetos_iniciativas WHERE id = $1 AND lider_id = $2', [req.params.id, req.user.id]);
  if (!dono.rows.length) return res.status(404).json({ erro: 'Projeto não encontrado.' });
  const atual = dono.rows[0];

  const body = req.body || {};
  try {
    let metaIdFinal = atual.meta_id;
    if (Object.prototype.hasOwnProperty.call(body, 'metaId')) {
      metaIdFinal = await validarMeta(body.metaId, req.user.id);
    }

    const { rows } = await pool.query(
      `UPDATE projetos_iniciativas SET
         nome = COALESCE($1, nome), meta_id = $2,
         equipe_areas = COALESCE($3, equipe_areas), recursos = COALESCE($4, recursos), checkpoints = COALESCE($5, checkpoints)
       WHERE id = $6 AND lider_id = $7 RETURNING *`,
      [body.nome, metaIdFinal, body.equipeAreas, body.recursos, body.checkpoints, req.params.id, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ erro: err.message });
    throw err;
  }
});

router.delete('/:id', requireAuth, requireLider, async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM projetos_iniciativas WHERE id = $1 AND lider_id = $2', [req.params.id, req.user.id]);
  if (!rowCount) return res.status(404).json({ erro: 'Projeto não encontrado.' });
  res.status(204).end();
});

module.exports = router;
