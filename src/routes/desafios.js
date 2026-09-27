const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireLider } = require('../middleware/auth');

const router = express.Router();

// A trilha em si (título, descrição, prazo, pontos) é parametrizada só pelo
// administrador, por turma — ver src/routes/admin.js. Aqui o líder só lê a
// trilha da própria turma e marca o próprio progresso.
const SELECT_COM_PROGRESSO = `
  SELECT d.id, d.titulo, d.descricao, d.secao_alvo, d.prazo, d.pontos, d.ordem,
         COALESCE(p.concluido, false) AS concluido, p.concluido_em
  FROM desafios_itens d
  LEFT JOIN desafios_progresso p ON p.desafio_id = d.id AND p.lider_id = $2
  WHERE d.turma_id = $1
  ORDER BY d.ordem ASC, d.criado_em ASC
`;

// Líder: lista a trilha da sua turma, já com o próprio progresso.
router.get('/', requireAuth, requireLider, async (req, res) => {
  if (!req.user.turmaId) return res.json([]); // ainda não foi colocado em nenhuma turma
  const { rows } = await pool.query(SELECT_COM_PROGRESSO, [req.user.turmaId, req.user.id]);
  res.json(rows);
});

// Líder: marca um item da trilha da própria turma como concluído/pendente.
router.put('/:id', requireAuth, requireLider, async (req, res) => {
  const { concluido } = req.body || {};
  if (typeof concluido !== 'boolean') return res.status(400).json({ erro: 'Informe concluido (true ou false).' });
  if (!req.user.turmaId) return res.status(403).json({ erro: 'Você ainda não está em uma turma.' });

  const desafio = await pool.query('SELECT id FROM desafios_itens WHERE id = $1 AND turma_id = $2', [req.params.id, req.user.turmaId]);
  if (!desafio.rows.length) return res.status(404).json({ erro: 'Desafio não encontrado.' });

  const { rows } = await pool.query(
    `INSERT INTO desafios_progresso (desafio_id, lider_id, concluido, concluido_em)
     VALUES ($1, $2, $3, CASE WHEN $3 THEN now() ELSE NULL END)
     ON CONFLICT (desafio_id, lider_id) DO UPDATE SET
       concluido = $3,
       concluido_em = CASE WHEN $3 THEN now() ELSE NULL END
     RETURNING desafio_id AS id, concluido, concluido_em`,
    [req.params.id, req.user.id, concluido]
  );
  res.json(rows[0]);
});

module.exports = router;
