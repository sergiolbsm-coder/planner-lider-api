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
  const { titulo, descricao, secaoAlvo, ordem } = req.body || {};
  if (!titulo || !titulo.trim()) return res.status(400).json({ erro: 'Dê um título ao desafio.' });

  const { rows } = await pool.query(
    `INSERT INTO desafios_itens (lider_id, titulo, descricao, secao_alvo, ordem)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING *`,
    [req.user.id, titulo.trim(), descricao || null, secaoAlvo || null, Number.isInteger(ordem) ? ordem : 0]
  );
  res.status(201).json(rows[0]);
});

// Líder: edita texto/seção/ordem OU só marca como concluído — os dois usos
// mandam campos diferentes, por isso é COALESCE contra a linha real (não um
// upsert), igual ao ajuste já feito em dashboard-config.
router.put('/:id', requireAuth, requireLider, async (req, res) => {
  const { titulo, descricao, secaoAlvo, concluido, ordem } = req.body || {};

  const { rows } = await pool.query(
    `UPDATE desafios_itens SET
       titulo = COALESCE($1, titulo),
       descricao = COALESCE($2, descricao),
       secao_alvo = COALESCE($3, secao_alvo),
       concluido = COALESCE($4, concluido),
       ordem = COALESCE($5, ordem)
     WHERE id = $6 AND lider_id = $7
     RETURNING *`,
    [titulo, descricao, secaoAlvo, concluido, ordem, req.params.id, req.user.id]
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
