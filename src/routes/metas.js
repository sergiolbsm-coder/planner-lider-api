const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireLider } = require('../middleware/auth');

const router = express.Router();

const FREQUENCIAS = ['semanal', 'quinzenal', 'mensal', 'trimestral'];
const PERSPECTIVAS_BSC = ['aprendizado', 'processos', 'clientes', 'financeira'];
const STATUS_EXECUCAO = ['no_prazo', 'atencao', 'atrasado', 'concluido'];

// Líder: lista todas as metas do workspace, com progresso calculado.
router.get('/', requireAuth, requireLider, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT m.id, m.lider_id, m.nome, m.tipo, m.indicador, m.valor, m.prazo, m.descricao, m.criado_em,
            m.porque_importa, m.ponto_partida, m.frequencia_acompanhamento, m.perspectiva_bsc,
            m.okr_objetivo, m.okr_kr1, m.okr_kr2, m.okr_kr3,
            m.acao_prioritaria, m.responsavel_acao, m.evidencia_conclusao, m.proxima_verificacao, m.status_execucao,
            COUNT(a.id) FILTER (WHERE a.meta_id = m.id) AS total_atividades,
            COUNT(a.id) FILTER (WHERE a.meta_id = m.id AND a.status = 'concluido') AS atividades_concluidas
     FROM metas m
     LEFT JOIN atividades a ON a.meta_id = m.id
     WHERE m.lider_id = $1
     GROUP BY m.id
     ORDER BY m.criado_em ASC`,
    [req.user.id]
  );
  res.json(rows);
});

// Liderado: metas vinculadas às atividades dele + a meta em texto livre do próprio perfil.
router.get('/minhas', requireAuth, async (req, res) => {
  if (req.user.role !== 'liderado') return res.status(403).json({ erro: 'Apenas contas de liderado usam esta rota.' });
  const { rows } = await pool.query(
    `SELECT DISTINCT m.*
     FROM metas m
     JOIN atividades a ON a.meta_id = m.id
     WHERE a.responsavel_id = $1
     ORDER BY m.criado_em ASC`,
    [req.user.id]
  );
  res.json(rows);
});

router.post('/', requireAuth, requireLider, async (req, res) => {
  const {
    nome, tipo, indicador, valor, prazo, descricao,
    porqueImporta, pontoPartida, frequenciaAcompanhamento, perspectivaBsc,
    okrObjetivo, okrKr1, okrKr2, okrKr3,
    acaoPrioritaria, responsavelAcao, evidenciaConclusao, proximaVerificacao, statusExecucao,
  } = req.body || {};
  if (!nome || !tipo) return res.status(400).json({ erro: 'Informe nome e categoria da meta.' });
  if (!['estrategico', 'tatico', 'operacional'].includes(tipo)) {
    return res.status(400).json({ erro: 'Categoria inválida.' });
  }
  if (frequenciaAcompanhamento && !FREQUENCIAS.includes(frequenciaAcompanhamento)) {
    return res.status(400).json({ erro: 'Frequência de acompanhamento inválida.' });
  }
  if (perspectivaBsc && !PERSPECTIVAS_BSC.includes(perspectivaBsc)) {
    return res.status(400).json({ erro: 'Perspectiva do BSC inválida.' });
  }
  if (statusExecucao && !STATUS_EXECUCAO.includes(statusExecucao)) {
    return res.status(400).json({ erro: 'Status de execução inválido.' });
  }

  const { rows } = await pool.query(
    `INSERT INTO metas (
       lider_id, nome, tipo, indicador, valor, prazo, descricao,
       porque_importa, ponto_partida, frequencia_acompanhamento, perspectiva_bsc,
       okr_objetivo, okr_kr1, okr_kr2, okr_kr3,
       acao_prioritaria, responsavel_acao, evidencia_conclusao, proxima_verificacao, status_execucao
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,COALESCE($20,'no_prazo'))
     RETURNING *`,
    [
      req.user.id, nome.trim(), tipo, indicador || null, valor || null, prazo || null, descricao || null,
      porqueImporta || null, pontoPartida || null, frequenciaAcompanhamento || null, perspectivaBsc || null,
      okrObjetivo || null, okrKr1 || null, okrKr2 || null, okrKr3 || null,
      acaoPrioritaria || null, responsavelAcao || null, evidenciaConclusao || null, proximaVerificacao || null, statusExecucao || null,
    ]
  );
  res.status(201).json(rows[0]);
});

router.put('/:id', requireAuth, requireLider, async (req, res) => {
  const {
    nome, tipo, indicador, valor, prazo, descricao,
    porqueImporta, pontoPartida, frequenciaAcompanhamento, perspectivaBsc,
    okrObjetivo, okrKr1, okrKr2, okrKr3,
    acaoPrioritaria, responsavelAcao, evidenciaConclusao, proximaVerificacao, statusExecucao,
  } = req.body || {};
  if (frequenciaAcompanhamento && !FREQUENCIAS.includes(frequenciaAcompanhamento)) {
    return res.status(400).json({ erro: 'Frequência de acompanhamento inválida.' });
  }
  if (perspectivaBsc && !PERSPECTIVAS_BSC.includes(perspectivaBsc)) {
    return res.status(400).json({ erro: 'Perspectiva do BSC inválida.' });
  }
  if (statusExecucao && !STATUS_EXECUCAO.includes(statusExecucao)) {
    return res.status(400).json({ erro: 'Status de execução inválido.' });
  }

  const { rows } = await pool.query(
    `UPDATE metas SET
       nome = COALESCE($1, nome), tipo = COALESCE($2, tipo), indicador = COALESCE($3, indicador),
       valor = COALESCE($4, valor), prazo = COALESCE($5, prazo), descricao = COALESCE($6, descricao),
       porque_importa = COALESCE($7, porque_importa), ponto_partida = COALESCE($8, ponto_partida),
       frequencia_acompanhamento = COALESCE($9, frequencia_acompanhamento), perspectiva_bsc = COALESCE($10, perspectiva_bsc),
       okr_objetivo = COALESCE($11, okr_objetivo), okr_kr1 = COALESCE($12, okr_kr1),
       okr_kr2 = COALESCE($13, okr_kr2), okr_kr3 = COALESCE($14, okr_kr3),
       acao_prioritaria = COALESCE($15, acao_prioritaria), responsavel_acao = COALESCE($16, responsavel_acao),
       evidencia_conclusao = COALESCE($17, evidencia_conclusao), proxima_verificacao = COALESCE($18, proxima_verificacao),
       status_execucao = COALESCE($19, status_execucao)
     WHERE id = $20 AND lider_id = $21 RETURNING *`,
    [
      nome, tipo, indicador, valor, prazo || null, descricao,
      porqueImporta, pontoPartida, frequenciaAcompanhamento, perspectivaBsc,
      okrObjetivo, okrKr1, okrKr2, okrKr3,
      acaoPrioritaria, responsavelAcao, evidenciaConclusao, proximaVerificacao || null, statusExecucao,
      req.params.id, req.user.id,
    ]
  );
  if (!rows.length) return res.status(404).json({ erro: 'Meta não encontrada.' });
  res.json(rows[0]);
});

router.delete('/:id', requireAuth, requireLider, async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM metas WHERE id = $1 AND lider_id = $2', [req.params.id, req.user.id]);
  if (!rowCount) return res.status(404).json({ erro: 'Meta não encontrada.' });
  res.status(204).end();
});

module.exports = router;
