const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireLider } = require('../middleware/auth');

const router = express.Router();

const STATUS = ['novo', 'andamento', 'bloqueado', 'concluido'];

// Mesmo padrão de atividades.js: responsável pode ser o próprio líder ('eu'),
// um liderado da equipe, ou ninguém (string vazia/undefined limpa o vínculo).
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

router.get('/', requireAuth, requireLider, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM plano_acao_itens WHERE lider_id = $1 ORDER BY ordem ASC', [req.user.id]);
  res.json(rows);
});

router.post('/', requireAuth, requireLider, async (req, res) => {
  const { acao, comoFazer, impacto, prazo, ordem, responsavelId, metaId, equipeAreas, recursos, checkpoints, dataInicio, dataFim, status, licoesAprendidas } = req.body || {};
  if (status && !STATUS.includes(status)) return res.status(400).json({ erro: 'Status inválido.' });

  try {
    const resp = await resolverResponsavel(responsavelId, req.user.id);
    const meta_id = await validarMeta(metaId, req.user.id);

    const { rows } = await pool.query(
      `INSERT INTO plano_acao_itens (
         lider_id, acao, como_fazer, impacto, prazo, ordem,
         responsavel_eu, responsavel_id, meta_id, equipe_areas, recursos, checkpoints,
         data_inicio, data_fim, status, licoes_aprendidas
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [
        req.user.id, acao || null, comoFazer || null, impacto || null, prazo || null, ordem || 0,
        resp.responsavel_eu, resp.responsavel_id, meta_id, equipeAreas || null, recursos || null, checkpoints || null,
        dataInicio || null, dataFim || null, status || 'novo', licoesAprendidas || null,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ erro: err.message });
    throw err;
  }
});

// PUT parcial via COALESCE contra a linha real — as duas telas (Projetos/
// Iniciativas e Acompanhamento por Equipe) mandam só os campos da sua
// própria aba a cada mudança, nunca a linha inteira. responsavelId e metaId
// usam hasOwnProperty em vez de COALESCE porque "limpar o vínculo" (mandar
// vazio) é uma ação válida e diferente de "campo omitido".
router.put('/:id', requireAuth, requireLider, async (req, res) => {
  const dono = await pool.query('SELECT * FROM plano_acao_itens WHERE id = $1 AND lider_id = $2', [req.params.id, req.user.id]);
  if (!dono.rows.length) return res.status(404).json({ erro: 'Ação não encontrada.' });
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

    let metaIdFinal = atual.meta_id;
    if (Object.prototype.hasOwnProperty.call(body, 'metaId')) {
      metaIdFinal = await validarMeta(body.metaId, req.user.id);
    }

    // dataInicio/dataFim vazios viram null antes do COALESCE — senão o Postgres
    // tenta ler string vazia como DATE e estoura erro (mesmo ajuste já feito
    // em metas.js pro campo prazo).
    const dataInicioSafe = body.dataInicio || null;
    const dataFimSafe = body.dataFim || null;

    const { rows } = await pool.query(
      `UPDATE plano_acao_itens SET
         acao = COALESCE($1, acao), como_fazer = COALESCE($2, como_fazer), impacto = COALESCE($3, impacto), prazo = COALESCE($4, prazo),
         responsavel_eu = $5, responsavel_id = $6, meta_id = $7,
         equipe_areas = COALESCE($8, equipe_areas), recursos = COALESCE($9, recursos), checkpoints = COALESCE($10, checkpoints),
         data_inicio = COALESCE($11, data_inicio), data_fim = COALESCE($12, data_fim),
         status = COALESCE($13, status), licoes_aprendidas = COALESCE($14, licoes_aprendidas)
       WHERE id = $15 AND lider_id = $16 RETURNING *`,
      [
        body.acao, body.comoFazer, body.impacto, body.prazo, responsavelEu, responsavelIdFinal, metaIdFinal,
        body.equipeAreas, body.recursos, body.checkpoints, dataInicioSafe, dataFimSafe, body.status, body.licoesAprendidas,
        req.params.id, req.user.id,
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ erro: err.message });
    throw err;
  }
});

router.delete('/:id', requireAuth, requireLider, async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM plano_acao_itens WHERE id = $1 AND lider_id = $2', [req.params.id, req.user.id]);
  if (!rowCount) return res.status(404).json({ erro: 'Ação não encontrada.' });
  res.status(204).end();
});

module.exports = router;
