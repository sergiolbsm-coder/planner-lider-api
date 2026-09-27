const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireLider } = require('../middleware/auth');

const router = express.Router();

// Líder: lista sua trilha de desafios, na ordem de exibição.
router.get('/', requireAuth, requireLider, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM desafios_itens WHERE lider_id = $1 ORDER BY ordem ASC, criado_em ASC',
    [req.user.id]
  );
  res.json(rows);
});

// Líder: adiciona um item na trilha (tela de Parametrização).
router.post('/', requireAuth, requireLider, async (req, res) => {
  const { titulo, descricao, secaoAlvo, prazo, pontos, ordem } = req.body || {};
  if (!titulo || !titulo.trim()) return res.status(400).json({ erro: 'Dê um título ao desafio.' });

  const { rows } = await pool.query(
    `INSERT INTO desafios_itens (lider_id, titulo, descricao, secao_alvo, prazo, pontos, ordem)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [req.user.id, titulo.trim(), descricao || null, secaoAlvo || null, prazo || null, Number.isInteger(pontos) ? pontos : 10, Number.isInteger(ordem) ? ordem : 0]
  );
  res.status(201).json(rows[0]);
});

// Líder: edita texto/seção/prazo/pontos/ordem OU só marca como concluído — os
// usos mandam campos diferentes, por isso é COALESCE contra a linha real (não
// um upsert), igual ao ajuste já feito em dashboard-config. concluido_em
// acompanha o toggle de "concluido" pra dar pra saber se entregou no prazo.
//
// secaoAlvo e prazo são exceção: "limpar" os dois é um valor válido (null),
// não "não mandei esse campo" — por isso usam presença da chave no body em
// vez de COALESCE, que não distingue "omitido" de "null explícito".
router.put('/:id', requireAuth, requireLider, async (req, res) => {
  const body = req.body || {};
  const { titulo, descricao, pontos, concluido, ordem } = body;
  const temSecao = Object.prototype.hasOwnProperty.call(body, 'secaoAlvo');
  const temPrazo = Object.prototype.hasOwnProperty.call(body, 'prazo');

  const { rows } = await pool.query(
    `UPDATE desafios_itens SET
       titulo = COALESCE($1, titulo),
       descricao = COALESCE($2, descricao),
       secao_alvo = CASE WHEN $3 THEN $4 ELSE secao_alvo END,
       prazo = CASE WHEN $5 THEN $6 ELSE prazo END,
       pontos = COALESCE($7, pontos),
       concluido = COALESCE($8, concluido),
       concluido_em = CASE WHEN $8 IS NULL THEN concluido_em WHEN $8 THEN now() ELSE NULL END,
       ordem = COALESCE($9, ordem)
     WHERE id = $10 AND lider_id = $11
     RETURNING *`,
    [titulo, descricao, temSecao, body.secaoAlvo || null, temPrazo, body.prazo || null, pontos, concluido, ordem, req.params.id, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ erro: 'Desafio não encontrado.' });
  res.json(rows[0]);
});

router.delete('/:id', requireAuth, requireLider, async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM desafios_itens WHERE id = $1 AND lider_id = $2', [req.params.id, req.user.id]);
  if (!rowCount) return res.status(404).json({ erro: 'Desafio não encontrado.' });
  res.status(204).end();
});

module.exports = router;
