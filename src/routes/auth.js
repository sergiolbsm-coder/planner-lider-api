const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { assinarToken } = require('../middleware/auth');

const router = express.Router();

function sanitizarUser(u) {
  return { id: u.id, role: u.role, nome: u.nome, email: u.email, area: u.area, cargo: u.cargo };
}

// Cadastro de um novo líder (cria o workspace dele).
router.post('/registrar-lider', async (req, res) => {
  const { nome, email, senha, area, cargo } = req.body || {};
  if (!nome || !email || !senha) {
    return res.status(400).json({ erro: 'Informe nome, e-mail e senha.' });
  }
  if (senha.length < 6) {
    return res.status(400).json({ erro: 'A senha precisa ter pelo menos 6 caracteres.' });
  }

  const emailNormalizado = String(email).trim().toLowerCase();
  const existente = await pool.query('SELECT id FROM users WHERE email = $1', [emailNormalizado]);
  if (existente.rows.length) {
    return res.status(409).json({ erro: 'Já existe uma conta com este e-mail.' });
  }

  const senhaHash = await bcrypt.hash(senha, 10);
  const { rows } = await pool.query(
    `INSERT INTO users (role, nome, email, senha_hash, area, cargo)
     VALUES ('lider', $1, $2, $3, $4, $5)
     RETURNING id, role, nome, email, area, cargo`,
    [nome.trim(), emailNormalizado, senhaHash, area || null, cargo || null]
  );

  const user = rows[0];
  res.status(201).json({ token: assinarToken(user), user: sanitizarUser(user) });
});

// Login — serve tanto para líder quanto para liderado (mesma tabela de usuários).
router.post('/login', async (req, res) => {
  const { email, senha } = req.body || {};
  if (!email || !senha) {
    return res.status(400).json({ erro: 'Informe e-mail e senha.' });
  }

  const emailNormalizado = String(email).trim().toLowerCase();
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [emailNormalizado]);
  const user = rows[0];
  if (!user) {
    return res.status(401).json({ erro: 'E-mail ou senha inválidos.' });
  }

  const ok = await bcrypt.compare(senha, user.senha_hash);
  if (!ok) {
    return res.status(401).json({ erro: 'E-mail ou senha inválidos.' });
  }

  res.json({ token: assinarToken(user), user: sanitizarUser(user) });
});

module.exports = router;
