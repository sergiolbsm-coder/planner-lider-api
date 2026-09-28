const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { assinarToken } = require('../middleware/auth');

const router = express.Router();

function sanitizarUser(u) {
  return { id: u.id, role: u.role, nome: u.nome, email: u.email, area: u.area, cargo: u.cargo, turmaId: u.turma_id };
}

// Cria a primeira (e única) conta de administrador do sistema. Só funciona
// enquanto nenhum admin existir ainda — depois disso fica permanentemente
// desativada, então não precisa (nem deve) guardar senha nenhuma no código:
// quem for virar admin chama essa rota uma vez, com a própria senha.
router.post('/bootstrap-admin', async (req, res) => {
  const { rows: existentes } = await pool.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (existentes.length) {
    return res.status(403).json({ erro: 'Já existe um administrador — esta rota não pode mais ser usada.' });
  }

  const { nome, email, senha } = req.body || {};
  if (!nome || !email || !senha) {
    return res.status(400).json({ erro: 'Informe nome, e-mail e senha.' });
  }
  if (senha.length < 6) {
    return res.status(400).json({ erro: 'A senha precisa ter pelo menos 6 caracteres.' });
  }

  const emailNormalizado = String(email).trim().toLowerCase();
  const existente = await pool.query('SELECT id, role FROM users WHERE email = $1', [emailNormalizado]);
  if (existente.rows.length) {
    return res.status(409).json({ erro: `Já existe uma conta (${existente.rows[0].role}) com este e-mail — use outro e-mail para o administrador.` });
  }

  const senhaHash = await bcrypt.hash(senha, 10);
  const { rows } = await pool.query(
    `INSERT INTO users (role, nome, email, senha_hash) VALUES ('admin', $1, $2, $3)
     RETURNING id, role, nome, email, area, cargo, turma_id`,
    [nome.trim(), emailNormalizado, senhaHash]
  );

  const user = rows[0];
  res.status(201).json({ token: assinarToken(user), user: sanitizarUser(user) });
});

// Login — serve pra admin, líder e liderado (mesma tabela de usuários). Desde
// que o mesmo e-mail passou a poder existir em mais de uma turma (ver unique
// index em schema.sql), um e-mail pode bater com mais de uma conta — por
// isso testamos a senha contra todas e, se mais de uma bater (mesmo e-mail e
// mesma senha em turmas diferentes), devolvemos a lista pra pessoa escolher
// em vez de logar arbitrariamente numa delas.
router.post('/login', async (req, res) => {
  const { email, senha, contaId } = req.body || {};
  if (!email || !senha) {
    return res.status(400).json({ erro: 'Informe e-mail e senha.' });
  }

  const emailNormalizado = String(email).trim().toLowerCase();
  const { rows } = await pool.query(
    `SELECT u.*, t.nome AS turma_nome FROM users u
     LEFT JOIN turmas t ON t.id = u.turma_id
     WHERE u.email = $1`,
    [emailNormalizado]
  );
  if (!rows.length) {
    return res.status(401).json({ erro: 'E-mail ou senha inválidos.' });
  }

  const conferencias = await Promise.all(rows.map(u => bcrypt.compare(senha, u.senha_hash)));
  const candidatos = rows.filter((_, i) => conferencias[i]);
  if (!candidatos.length) {
    return res.status(401).json({ erro: 'E-mail ou senha inválidos.' });
  }

  let user = candidatos[0];
  if (candidatos.length > 1) {
    if (contaId) {
      user = candidatos.find(u => u.id === contaId);
      if (!user) return res.status(401).json({ erro: 'E-mail ou senha inválidos.' });
    } else {
      return res.json({
        contas: candidatos.map(u => ({
          id: u.id, role: u.role, nome: u.nome,
          turmaNome: u.turma_nome || null,
        })),
      });
    }
  }

  res.json({ token: assinarToken(user), user: sanitizarUser(user) });
});

module.exports = router;
