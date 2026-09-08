require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');
const app = require('./app');

const PORT = process.env.PORT || 3000;

// Aplica o schema automaticamente ao subir — tudo em schema.sql é
// "CREATE ... IF NOT EXISTS", então rodar de novo a cada boot é seguro
// e evita precisar compartilhar a connection string do Neon com mais ninguém.
async function migrarESubir() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  console.log('Aplicando schema no banco...');
  await pool.query(sql);
  console.log('Schema OK.');

  app.listen(PORT, () => console.log(`planner-lider-api rodando na porta ${PORT}`));
}

migrarESubir().catch(err => {
  console.error('Falha ao subir a API:', err);
  process.exit(1);
});
