const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireLider } = require('../middleware/auth');

const router = express.Router();

const STATUS = ['novo', 'andamento', 'bloqueado', 'concluido'];

// Mesmo padrão de atividades/plano_acao/matriz: responsável pode ser o
// próprio líder ('eu'), um liderado da equipe, ou nenhum (string vazia/omitido).
async function resolverResponsavel(responsavelId, liderId) {
  if (!responsavelId) return { responsavel_eu: false, responsavel_id: null };
  if (responsavelId === 'eu') return { responsavel_eu: true, responsavel_id: null };
  const { rows } = await pool.query('SELECT id FROM users WHERE id = $1 AND lider_id = $2', [responsavelId, liderId]);
  if (!rows.length) throw Object.assign(new Error('Responsável inválido.'), { status: 400 });
  return { responsavel_eu: false, responsavel_id: responsavelId };
}

router.get('/', requireAuth, requireLider, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM projetos_iniciativas WHERE lider_id = $1 ORDER BY ordem ASC', [req.user.id]);
  res.json(rows);
});

router.post('/', requireAuth, requireLider, async (req, res) => {
  const { nome, objetivo, responsavelId, prazo, impedimentos, status, resultadoEsperado, ordem } = req.body || {};
  if (status && !STATUS.includes(status)) return res.status(400).json({ erro: 'Status inválido.' });
  try {
    const resp = await resolverResponsavel(responsavelId, req.user.id);
    const { rows } = await pool.query(
      `INSERT INTO projetos_iniciativas (lider_id, nome, objetivo, responsavel_eu, responsavel_id, prazo, impedimentos, status, resultado_esperado, ordem)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.user.id, nome || null, objetivo || null, resp.responsavel_eu, resp.responsavel_id, prazo || null, impedimentos || null, status || 'novo', resultadoEsperado || null, ordem || 0]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ erro: err.message });
    throw err;
  }
});

// PUT parcial via COALESCE — responsavelId/prazo usam hasOwnProperty porque
// limpar o vínculo é uma ação válida, diferente de "campo omitido" (mesmo
// padrão de plano_acao_itens/atividades/matriz).
router.put('/:id', requireAuth, requireLider, async (req, res) => {
  const dono = await pool.query('SELECT * FROM projetos_iniciativas WHERE id = $1 AND lider_id = $2', [req.params.id, req.user.id]);
  if (!dono.rows.length) return res.status(404).json({ erro: 'Projeto não encontrado.' });
  const atual = dono.rows[0];

  const body = req.body || {};
  if (body.status !== undefined && body.status && !STATUS.includes(body.status)) {
    return res.status(400).json({ erro: 'Status inválido.' });
  }
  try {
    let responsavelEu = atual.responsavel_eu;
    let responsavelIdFinal = atual.responsavel_id;
    if (Object.prototype.hasOwnProperty.call(body, 'responsavelId')) {
      const resp = await resolverResponsavel(body.responsavelId, req.user.id);
      responsavelEu = resp.responsavel_eu;
      responsavelIdFinal = resp.responsavel_id;
    }

    const prazoFinal = Object.prototype.hasOwnProperty.call(body, 'prazo') ? (body.prazo || null) : atual.prazo;

    const { rows } = await pool.query(
      `UPDATE projetos_iniciativas SET
         nome = COALESCE($1, nome), objetivo = COALESCE($2, objetivo),
         responsavel_eu = $3, responsavel_id = $4, prazo = $5,
         impedimentos = COALESCE($6, impedimentos), status = COALESCE($7, status),
         resultado_esperado = COALESCE($8, resultado_esperado)
       WHERE id = $9 AND lider_id = $10 RETURNING *`,
      [body.nome, body.objetivo, responsavelEu, responsavelIdFinal, prazoFinal, body.impedimentos, body.status, body.resultadoEsperado, req.params.id, req.user.id]
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
