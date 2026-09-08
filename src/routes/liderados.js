const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { requireAuth, requireLider } = require('../middleware/auth');

const router = express.Router();

const SELECT_LIDERADO = `
  SELECT u.id, u.nome, u.email, u.cargo, u.criado_em,
         p.data_inicio, p.perfil_comportamental, p.habilidades, p.expectativas,
         p.metas_texto, p.desenvolvimento, p.obs, p.aspiracoes, p.comportamentos, p.sentimentos
  FROM users u
  LEFT JOIN perfis_liderado p ON p.user_id = u.id
`;

// Líder: lista sua equipe.
router.get('/', requireAuth, requireLider, async (req, res) => {
  const { rows } = await pool.query(
    `${SELECT_LIDERADO} WHERE u.lider_id = $1 ORDER BY u.criado_em ASC`,
    [req.user.id]
  );
  res.json(rows);
});

// Líder: cadastra um novo liderado (cria login dele também).
router.post('/', requireAuth, requireLider, async (req, res) => {
  const { nome, email, senha, cargo, dataInicio, perfilComportamental, habilidades, expectativas, metasTexto, desenvolvimento, obs } = req.body || {};
  if (!nome || !email || !senha) {
    return res.status(400).json({ erro: 'Informe nome, e-mail e senha do liderado.' });
  }
  if (senha.length < 6) {
    return res.status(400).json({ erro: 'A senha precisa ter pelo menos 6 caracteres.' });
  }

  const emailNormalizado = String(email).trim().toLowerCase();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existente = await client.query('SELECT id FROM users WHERE email = $1', [emailNormalizado]);
    if (existente.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ erro: 'Já existe uma conta com este e-mail.' });
    }

    const senhaHash = await bcrypt.hash(senha, 10);
    const { rows: userRows } = await client.query(
      `INSERT INTO users (role, nome, email, senha_hash, lider_id, cargo)
       VALUES ('liderado', $1, $2, $3, $4, $5)
       RETURNING id`,
      [nome.trim(), emailNormalizado, senhaHash, req.user.id, cargo || null]
    );
    const liderado_id = userRows[0].id;

    await client.query(
      `INSERT INTO perfis_liderado (user_id, data_inicio, perfil_comportamental, habilidades, expectativas, metas_texto, desenvolvimento, obs)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [liderado_id, dataInicio || null, perfilComportamental || null, habilidades || null, expectativas || null, metasTexto || null, desenvolvimento || null, obs || null]
    );

    await client.query('COMMIT');

    const { rows } = await pool.query(`${SELECT_LIDERADO} WHERE u.id = $1`, [liderado_id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// Líder: atualiza cadastro + perfil (inclui os campos do Diário de Bordo).
router.put('/:id', requireAuth, requireLider, async (req, res) => {
  const { id } = req.params;
  const dono = await pool.query('SELECT id FROM users WHERE id = $1 AND lider_id = $2', [id, req.user.id]);
  if (!dono.rows.length) return res.status(404).json({ erro: 'Liderado não encontrado.' });

  const { nome, cargo, dataInicio, perfilComportamental, habilidades, expectativas, metasTexto, desenvolvimento, obs, aspiracoes, comportamentos, sentimentos } = req.body || {};

  if (nome !== undefined || cargo !== undefined) {
    await pool.query(
      `UPDATE users SET nome = COALESCE($1, nome), cargo = COALESCE($2, cargo) WHERE id = $3`,
      [nome, cargo, id]
    );
  }

  await pool.query(
    `UPDATE perfis_liderado SET
       data_inicio = COALESCE($1, data_inicio),
       perfil_comportamental = COALESCE($2, perfil_comportamental),
       habilidades = COALESCE($3, habilidades),
       expectativas = COALESCE($4, expectativas),
       metas_texto = COALESCE($5, metas_texto),
       desenvolvimento = COALESCE($6, desenvolvimento),
       obs = COALESCE($7, obs),
       aspiracoes = COALESCE($8, aspiracoes),
       comportamentos = COALESCE($9, comportamentos),
       sentimentos = COALESCE($10, sentimentos)
     WHERE user_id = $11`,
    [dataInicio, perfilComportamental, habilidades, expectativas, metasTexto, desenvolvimento, obs, aspiracoes, comportamentos, sentimentos, id]
  );

  const { rows } = await pool.query(`${SELECT_LIDERADO} WHERE u.id = $1`, [id]);
  res.json(rows[0]);
});

// Líder: remove um liderado (cascade cuida do perfil e dos registros do diário).
router.delete('/:id', requireAuth, requireLider, async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM users WHERE id = $1 AND lider_id = $2', [req.params.id, req.user.id]);
  if (!rowCount) return res.status(404).json({ erro: 'Liderado não encontrado.' });
  res.status(204).end();
});

// Liderado: seu próprio perfil (usado na tela dele).
router.get('/me', requireAuth, async (req, res) => {
  if (req.user.role !== 'liderado') return res.status(403).json({ erro: 'Apenas contas de liderado usam esta rota.' });
  const { rows } = await pool.query(`${SELECT_LIDERADO} WHERE u.id = $1`, [req.user.id]);
  if (!rows.length) return res.status(404).json({ erro: 'Perfil não encontrado.' });
  res.json(rows[0]);
});

module.exports = router;
