const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireLider } = require('../middleware/auth');

const router = express.Router();

// Área Individual: o que o Trainer (admin) manda só pra este líder — mensagens
// e arquivos, separados dos "Arquivos da Aula" (abertos pra turma toda).
// Só o líder em pessoa vê isso — diferente de /arquivos, aqui não faz
// sentido o liderado herdar o que o Trainer mandou pro líder dele.
router.use(requireAuth, requireLider);

router.get('/mensagens', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM mensagens_individuais WHERE lider_id = $1 ORDER BY criado_em DESC',
    [req.user.id]
  );
  res.json(rows);
});

router.put('/mensagens/:id/lida', async (req, res) => {
  const { rows } = await pool.query(
    'UPDATE mensagens_individuais SET lida = true WHERE id = $1 AND lider_id = $2 RETURNING id',
    [req.params.id, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ erro: 'Mensagem não encontrada.' });
  res.status(204).end();
});

router.get('/arquivos', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.id, a.nome, a.descricao, a.tipo_mime, a.tamanho_bytes, a.criado_em FROM arquivos_aula a
     JOIN arquivo_lideres al ON al.arquivo_id = a.id AND al.lider_id = $1
     ORDER BY a.criado_em DESC`,
    [req.user.id]
  );
  res.json(rows);
});

router.get('/arquivos/:id/download', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.nome, a.tipo_mime, a.conteudo FROM arquivos_aula a
     JOIN arquivo_lideres al ON al.arquivo_id = a.id AND al.lider_id = $2
     WHERE a.id = $1`,
    [req.params.id, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ erro: 'Arquivo não encontrado.' });

  const arquivo = rows[0];
  const nomeAscii = arquivo.nome.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
  res.setHeader('Content-Type', arquivo.tipo_mime);
  res.setHeader('Content-Disposition', `attachment; filename="${nomeAscii}"; filename*=UTF-8''${encodeURIComponent(arquivo.nome)}`);
  res.send(arquivo.conteudo);
});

module.exports = router;
