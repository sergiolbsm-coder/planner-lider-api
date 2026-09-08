const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL não configurada. Defina a variável de ambiente com a connection string do Neon.');
}

// Neon exige SSL. rejectUnauthorized:false evita erro de cadeia de certificado
// em ambientes onde o CA raiz não está disponível localmente.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

module.exports = { pool };
