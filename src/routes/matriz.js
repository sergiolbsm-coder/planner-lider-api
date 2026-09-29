const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireLider } = require('../middleware/auth');

const router = express.Router();

// Mesmo padrão de atividades/plano_acao: responsável pode ser o próprio
// líder ('eu'), um liderado da equipe, ou nenhum (string vazia/omitido).
async function resolverResponsavel(responsavelId, liderId) {
  if (!responsavelId) return { responsavel_eu: false, responsavel_id: null };
  if (responsavelId === 'eu') return { responsavel_eu: true, responsavel_id: null };
  const { rows } = await pool.query('SELECT id FROM users WHERE id = $1 AND lider_id = $2', [responsavelId, liderId]);
  if (!rows.length) throw Object.assign(new Error('Responsável inválido.'), { status: 400 });
  return { responsavel_eu: false, responsavel_id: responsavelId };
}

router.get('/', requireAuth, requireLider, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM matriz_itens WHERE lider_id = $1 ORDER BY criado_em ASC', [req.user.id]);
  res.json(rows);
});

router.post('/', requireAuth, requireLider, async (req, res) => {
  const { titulo, resultado, esforco, obs, responsavelId } = req.body || {};
  if (!titulo || !resultado || !esforco) return res.status(400).json({ erro: 'Informe título, resultado e esforço.' });
  try {
    const resp = await resolverResponsavel(responsavelId, req.user.id);
    const { rows } = await pool.query(
      `INSERT INTO matriz_itens (lider_id, titulo, resultado, esforco, obs, responsavel_eu, responsavel_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.id, titulo.trim(), resultado, esforco, obs || null, resp.responsavel_eu, resp.responsavel_id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ erro: err.message });
    throw err;
  }
});

router.put('/:id', requireAuth, requireLider, async (req, res) => {
  const dono = await pool.query('SELECT * FROM matriz_itens WHERE id = $1 AND lider_id = $2', [req.params.id, req.user.id]);
  if (!dono.rows.length) return res.status(404).json({ erro: 'Item não encontrado.' });
  const atual = dono.rows[0];

  const { titulo, resultado, esforco, obs, responsavelId } = req.body || {};
  try {
    let responsavelEu = atual.responsavel_eu;
    let responsavelIdFinal = atual.responsavel_id;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'responsavelId')) {
      const resp = await resolverResponsavel(responsavelId, req.user.id);
      responsavelEu = resp.responsavel_eu;
      responsavelIdFinal = resp.responsavel_id;
    }

    const { rows } = await pool.query(
      `UPDATE matriz_itens SET titulo = COALESCE($1, titulo), resultado = COALESCE($2, resultado),
         esforco = COALESCE($3, esforco), obs = COALESCE($4, obs), responsavel_eu = $5, responsavel_id = $6
       WHERE id = $7 AND lider_id = $8 RETURNING *`,
      [titulo, resultado, esforco, obs, responsavelEu, responsavelIdFinal, req.params.id, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ erro: err.message });
    throw err;
  }
});

router.delete('/:id', requireAuth, requireLider, async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM matriz_itens WHERE id = $1 AND lider_id = $2', [req.params.id, req.user.id]);
  if (!rowCount) return res.status(404).json({ erro: 'Item não encontrado.' });
  res.status(204).end();
});

module.exports = router;
