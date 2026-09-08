/**
 * Aplica o schema.sql no banco apontado por DATABASE_URL.
 * Uso: npm run migrate
 * Seguro rodar mais de uma vez (tudo é CREATE ... IF NOT EXISTS).
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  console.log('Aplicando schema...');
  await pool.query(sql);
  console.log('Schema aplicado com sucesso.');
  await pool.end();
}

main().catch(err => {
  console.error('Falha ao aplicar o schema:', err);
  process.exit(1);
});
