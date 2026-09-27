const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireLider } = require('../middleware/auth');

const router = express.Router();

const VAZIO = {
  expectativas_ano: '', pontos_fortes_equipe: '', visao_missao: '',
  meta_desempenho: '', meta_processos: '', lema_do_ano: '', combinados: '',
  de_onde_viemos: '', como_nos_guiamos: '', para_quem_valor: '', o_que_da_poder: '', para_onde_vamos: '',
};

// Líder: lê seu Plano de Gestão (vazio se ainda não preencheu nada).
router.get('/', requireAuth, requireLider, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM plano_gestao WHERE lider_id = $1', [req.user.id]);
  res.json(rows[0] || { lider_id: req.user.id, ...VAZIO });
});

// Líder: salva o plano — PUT parcial via COALESCE contra a linha real, mesmo
// ajuste já usado em dashboard-config (o front salva uma aba por vez: Criação
// do Plano manda um conjunto de campos, a Ferramenta Avião manda outro).
router.put('/', requireAuth, requireLider, async (req, res) => {
  const {
    expectativasAno, pontosFortesEquipe, visaoMissao, metaDesempenho, metaProcessos, lemaDoAno, combinados,
    deOndeViemos, comoNosGuiamos, paraQuemValor, oQueDaPoder, paraOndeVamos,
  } = req.body || {};

  await pool.query('INSERT INTO plano_gestao (lider_id) VALUES ($1) ON CONFLICT (lider_id) DO NOTHING', [req.user.id]);

  const { rows } = await pool.query(
    `UPDATE plano_gestao SET
       expectativas_ano = COALESCE($2, expectativas_ano),
       pontos_fortes_equipe = COALESCE($3, pontos_fortes_equipe),
       visao_missao = COALESCE($4, visao_missao),
       meta_desempenho = COALESCE($5, meta_desempenho),
       meta_processos = COALESCE($6, meta_processos),
       lema_do_ano = COALESCE($7, lema_do_ano),
       combinados = COALESCE($8, combinados),
       de_onde_viemos = COALESCE($9, de_onde_viemos),
       como_nos_guiamos = COALESCE($10, como_nos_guiamos),
       para_quem_valor = COALESCE($11, para_quem_valor),
       o_que_da_poder = COALESCE($12, o_que_da_poder),
       para_onde_vamos = COALESCE($13, para_onde_vamos),
       atualizado_em = now()
     WHERE lider_id = $1
     RETURNING *`,
    [req.user.id, expectativasAno, pontosFortesEquipe, visaoMissao, metaDesempenho, metaProcessos, lemaDoAno, combinados,
      deOndeViemos, comoNosGuiamos, paraQuemValor, oQueDaPoder, paraOndeVamos]
  );
  res.json(rows[0]);
});

module.exports = router;
