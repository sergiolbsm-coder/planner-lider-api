const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const SELECT_METADADOS = 'a.id, a.nome, a.descricao, a.pasta, a.tipo_mime, a.tamanho_bytes, a.criado_em';

// Upload/edição/exclusão/vínculo agora são só do administrador — ver
// src/routes/admin.js. Aqui líder e liderado só leem os arquivos vinculados à
// turma do seu líder (um arquivo pode estar vinculado a mais de uma turma):
// req.user.liderId resolve pro próprio id (se for líder) ou pro id do líder
// dele (se for liderado) — por isso a mesma query serve os dois papéis.
const LISTAR = `
  SELECT DISTINCT ${SELECT_METADADOS} FROM arquivos_aula a
  JOIN arquivo_turmas vt ON vt.arquivo_id = a.id
  JOIN users lider ON lider.id = $1 AND lider.turma_id = vt.turma_id
  ORDER BY a.criado_em DESC
`;

router.get('/', requireAuth, async (req, res) => {
  const { rows } = await pool.query(LISTAR, [req.user.liderId]);
  res.json(rows);
});

router.get('/minha-turma', requireAuth, async (req, res) => {
  const { rows } = await pool.query(LISTAR, [req.user.liderId]);
  res.json(rows);
});

router.get('/:id/download', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT DISTINCT a.nome, a.tipo_mime, a.tamanho_bytes, a.conteudo FROM arquivos_aula a
     JOIN arquivo_turmas vt ON vt.arquivo_id = a.id
     JOIN users lider ON lider.id = $2 AND lider.turma_id = vt.turma_id
     WHERE a.id = $1`,
    [req.params.id, req.user.liderId]
  );
  if (!rows.length) return res.status(404).json({ erro: 'Arquivo não encontrado.' });

  const arquivo = rows[0];
  // filename simples (ASCII, pro navegador que não lê filename*) + filename*
  // no formato RFC 5987 (nome com acento/emoji correto) — sem isso alguns
  // navegadores salvavam o arquivo com "%20"/"%C3%A7" literais no nome.
  const nomeAscii = arquivo.nome.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
  res.setHeader('Content-Type', arquivo.tipo_mime);
  res.setHeader('Content-Disposition', `attachment; filename="${nomeAscii}"; filename*=UTF-8''${encodeURIComponent(arquivo.nome)}`);
  // Content-Length explícito: sem isso a resposta vai em chunked transfer, e
  // alguns proxies/conexões lentas cortam downloads binários grandes antes
  // de terminar sem esse cabeçalho avisando o tamanho total de antemão.
  res.setHeader('Content-Length', arquivo.tamanho_bytes ?? arquivo.conteudo.length);
  res.send(arquivo.conteudo);
});

module.exports = router;
