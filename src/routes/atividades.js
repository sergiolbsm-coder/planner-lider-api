const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireLider } = require('../middleware/auth');

const router = express.Router();

const RESULTADOS = ['alto', 'medio', 'baixo', 'delegavel', 'eliminavel'];
const TIPOS = ['estrategico', 'tatico', 'operacional'];
const STATUS = ['novo', 'andamento', 'bloqueado', 'concluido'];

async function resolverResponsavel(responsavelId, liderId) {
  if (!responsavelId) return { responsavel_eu: false, responsavel_id: null };
  if (responsavelId === 'eu') return { responsavel_eu: true, responsavel_id: null };
  const { rows } = await pool.query('SELECT id FROM users WHERE id = $1 AND lider_id = $2', [responsavelId, liderId]);
  if (!rows.length) throw Object.assign(new Error('Responsável inválido.'), { status: 400 });
  return { responsavel_eu: false, responsavel_id: responsavelId };
}

async function validarMeta(metaId, liderId) {
  if (!metaId) return null;
  const { rows } = await pool.query('SELECT id FROM metas WHERE id = $1 AND lider_id = $2', [metaId, liderId]);
  if (!rows.length) throw Object.assign(new Error('Meta inválida.'), { status: 400 });
  return metaId;
}

// Líder: lista todas as atividades do quadro.
router.get('/', requireAuth, requireLider, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM atividades WHERE lider_id = $1 ORDER BY criado_em DESC', [req.user.id]);
  res.json(rows);
});

// Liderado: só as atividades atribuídas a ele mesmo.
router.get('/minhas', requireAuth, async (req, res) => {
  if (req.user.role !== 'liderado') return res.status(403).json({ erro: 'Apenas contas de liderado usam esta rota.' });
  const { rows } = await pool.query('SELECT * FROM atividades WHERE responsavel_id = $1 ORDER BY criado_em DESC', [req.user.id]);
  res.json(rows);
});

router.post('/', requireAuth, requireLider, async (req, res) => {
  const { titulo, resultado, tipo, status, prazo, responsavelId, metaId, obs } = req.body || {};
  if (!titulo || !resultado || !tipo) return res.status(400).json({ erro: 'Informe título, resultado e tipo.' });
  if (!RESULTADOS.includes(resultado)) return res.status(400).json({ erro: 'Resultado inválido.' });
  if (!TIPOS.includes(tipo)) return res.status(400).json({ erro: 'Tipo inválido.' });
  const statusFinal = STATUS.includes(status) ? status : 'novo';

  try {
    const resp = await resolverResponsavel(responsavelId, req.user.id);
    const meta_id = await validarMeta(metaId, req.user.id);

    const { rows } = await pool.query(
      `INSERT INTO atividades (lider_id, titulo, resultado, tipo, status, prazo, responsavel_eu, responsavel_id, meta_id, obs)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.user.id, titulo.trim(), resultado, tipo, statusFinal, prazo || null, resp.responsavel_eu, resp.responsavel_id, meta_id, obs || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ erro: err.message });
    throw err;
  }
});

router.put('/:id', requireAuth, requireLider, async (req, res) => {
  const { titulo, resultado, tipo, status, prazo, responsavelId, metaId, obs } = req.body || {};
  if (resultado && !RESULTADOS.includes(resultado)) return res.status(400).json({ erro: 'Resultado inválido.' });
  if (tipo && !TIPOS.includes(tipo)) return res.status(400).json({ erro: 'Tipo inválido.' });
  if (status && !STATUS.includes(status)) return res.status(400).json({ erro: 'Status inválido.' });

  // prazo, responsavelId e metaId são sempre enviados pelo formulário (mesmo vazios,
  // quando o campo foi limpo), então são sempre GRAVADOS — não usam COALESCE.
  const prazoFinal = prazo ? prazo : null;

  try {
    const resp = await resolverResponsavel(responsavelId, req.user.id);
    const meta_id = await validarMeta(metaId, req.user.id);

    const { rows } = await pool.query(
      `UPDATE atividades SET
         titulo = COALESCE($1, titulo),
         resultado = COALESCE($2, resultado),
         tipo = COALESCE($3, tipo),
         status = COALESCE($4, status),
         prazo = $5,
         responsavel_eu = $6,
         responsavel_id = $7,
         meta_id = $8,
         obs = COALESCE($9, obs),
         atualizado_em = now()
       WHERE id = $10 AND lider_id = $11
       RETURNING *`,
      [titulo, resultado, tipo, status, prazoFinal, resp.responsavel_eu, resp.responsavel_id, meta_id, obs, req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ erro: 'Atividade não encontrada.' });
    res.json(rows[0]);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ erro: err.message });
    throw err;
  }
});

// Atalho pra mover o card entre colunas do Kanban.
router.patch('/:id/status', requireAuth, requireLider, async (req, res) => {
  const { status } = req.body || {};
  if (!STATUS.includes(status)) return res.status(400).json({ erro: 'Status inválido.' });
  const { rows } = await pool.query(
    `UPDATE atividades SET status = $1, atualizado_em = now() WHERE id = $2 AND lider_id = $3 RETURNING *`,
    [status, req.params.id, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ erro: 'Atividade não encontrada.' });
  res.json(rows[0]);
});

router.delete('/:id', requireAuth, requireLider, async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM atividades WHERE id = $1 AND lider_id = $2', [req.params.id, req.user.id]);
  if (!rowCount) return res.status(404).json({ erro: 'Atividade não encontrada.' });
  res.status(204).end();
});

module.exports = router;
