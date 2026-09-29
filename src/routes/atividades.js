const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireLider } = require('../middleware/auth');

const router = express.Router();

const RESULTADOS = ['alto', 'medio', 'baixo', 'delegavel', 'eliminavel'];
const TIPOS = ['estrategico', 'tatico', 'operacional'];
const STATUS = ['novo', 'andamento', 'bloqueado', 'concluido'];
const TIPOS_VINCULO = ['meta', 'okr', 'bsc', 'plano_acao'];

async function resolverResponsavel(responsavelId, liderId) {
  if (!responsavelId) return { responsavel_eu: false, responsavel_id: null };
  if (responsavelId === 'eu') return { responsavel_eu: true, responsavel_id: null };
  const { rows } = await pool.query('SELECT id FROM users WHERE id = $1 AND lider_id = $2', [responsavelId, liderId]);
  if (!rows.length) throw Object.assign(new Error('Responsável inválido.'), { status: 400 });
  return { responsavel_eu: false, responsavel_id: responsavelId };
}

// Resolve a que a atividade está vinculada: uma Meta/Indicador, o OKR ou a
// perspectiva do BSC de uma meta (todos apontam pra metas.id — o que muda é
// só o enquadramento escolhido), ou um item do Plano de Ação. Compatibilidade:
// quem manda metaId sem tipoVinculo (fluxo antigo) continua funcionando como
// vínculo de meta.
async function resolverVinculo(tipoVinculo, metaId, planoAcaoId, liderId) {
  if (!tipoVinculo && metaId) tipoVinculo = 'meta';
  if (!tipoVinculo) return { tipo_vinculo: null, meta_id: null, plano_acao_id: null };
  if (!TIPOS_VINCULO.includes(tipoVinculo)) {
    throw Object.assign(new Error('Tipo de vínculo inválido.'), { status: 400 });
  }

  if (tipoVinculo === 'plano_acao') {
    if (!planoAcaoId) throw Object.assign(new Error('Selecione o item do Plano de Ação.'), { status: 400 });
    const { rows } = await pool.query('SELECT id FROM plano_acao_itens WHERE id = $1 AND lider_id = $2', [planoAcaoId, liderId]);
    if (!rows.length) throw Object.assign(new Error('Item do Plano de Ação inválido.'), { status: 400 });
    return { tipo_vinculo: tipoVinculo, meta_id: null, plano_acao_id: planoAcaoId };
  }

  if (!metaId) throw Object.assign(new Error('Selecione a meta.'), { status: 400 });
  const { rows } = await pool.query('SELECT id FROM metas WHERE id = $1 AND lider_id = $2', [metaId, liderId]);
  if (!rows.length) throw Object.assign(new Error('Meta inválida.'), { status: 400 });
  return { tipo_vinculo: tipoVinculo, meta_id: metaId, plano_acao_id: null };
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
  const { titulo, resultado, tipo, status, prazo, responsavelId, metaId, tipoVinculo, planoAcaoId, obs } = req.body || {};
  if (!titulo || !resultado || !tipo) return res.status(400).json({ erro: 'Informe título, resultado e tipo.' });
  if (!RESULTADOS.includes(resultado)) return res.status(400).json({ erro: 'Resultado inválido.' });
  if (!TIPOS.includes(tipo)) return res.status(400).json({ erro: 'Tipo inválido.' });
  const statusFinal = STATUS.includes(status) ? status : 'novo';

  try {
    const resp = await resolverResponsavel(responsavelId, req.user.id);
    const vinculo = await resolverVinculo(tipoVinculo, metaId, planoAcaoId, req.user.id);

    const { rows } = await pool.query(
      `INSERT INTO atividades (lider_id, titulo, resultado, tipo, status, prazo, responsavel_eu, responsavel_id, meta_id, tipo_vinculo, plano_acao_id, obs)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [req.user.id, titulo.trim(), resultado, tipo, statusFinal, prazo || null, resp.responsavel_eu, resp.responsavel_id,
        vinculo.meta_id, vinculo.tipo_vinculo, vinculo.plano_acao_id, obs || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ erro: err.message });
    throw err;
  }
});

router.put('/:id', requireAuth, requireLider, async (req, res) => {
  const { titulo, resultado, tipo, status, prazo, responsavelId, metaId, tipoVinculo, planoAcaoId, obs } = req.body || {};
  if (resultado && !RESULTADOS.includes(resultado)) return res.status(400).json({ erro: 'Resultado inválido.' });
  if (tipo && !TIPOS.includes(tipo)) return res.status(400).json({ erro: 'Tipo inválido.' });
  if (status && !STATUS.includes(status)) return res.status(400).json({ erro: 'Status inválido.' });

  // prazo, responsavelId e o vínculo são sempre enviados pelo formulário (mesmo
  // vazios, quando o campo foi limpo), então são sempre GRAVADOS — não usam COALESCE.
  const prazoFinal = prazo ? prazo : null;

  try {
    const resp = await resolverResponsavel(responsavelId, req.user.id);
    const vinculo = await resolverVinculo(tipoVinculo, metaId, planoAcaoId, req.user.id);

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
         tipo_vinculo = $9,
         plano_acao_id = $10,
         obs = COALESCE($11, obs),
         atualizado_em = now()
       WHERE id = $12 AND lider_id = $13
       RETURNING *`,
      [titulo, resultado, tipo, status, prazoFinal, resp.responsavel_eu, resp.responsavel_id,
        vinculo.meta_id, vinculo.tipo_vinculo, vinculo.plano_acao_id, obs, req.params.id, req.user.id]
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
