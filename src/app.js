require('express-async-errors'); // faz next(err) automático em rotas async que derem throw

const express = require('express');
const cors = require('cors');

const app = express();

// Origens permitidas a chamar a API — o site do planner e localhost pra desenvolvimento.
const ORIGENS_PERMITIDAS = (process.env.ALLOWED_ORIGINS || 'https://planner.institutodalideranca.com.br')
  .split(',')
  .map(s => s.trim());

app.use(cors({
  origin(origin, callback) {
    // Requisições sem 'origin' (curl, health checks) são liberadas.
    if (!origin || ORIGENS_PERMITIDAS.includes(origin) || origin.startsWith('http://localhost')) {
      return callback(null, true);
    }
    callback(new Error('Origem não permitida: ' + origin));
  },
}));
app.use(express.json());

app.get('/', (req, res) => res.json({ status: 'ok', servico: 'planner-lider-api' }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/auth', require('./routes/auth'));
app.use('/liderados', require('./routes/liderados'));
app.use('/metas', require('./routes/metas'));
app.use('/atividades', require('./routes/atividades'));
app.use('/matriz', require('./routes/matriz'));
app.use('/diario', require('./routes/diario'));
app.use('/rotina', require('./routes/rotina'));
app.use('/plano-acao', require('./routes/planoAcao'));
app.use('/dashboard-config', require('./routes/dashboardConfig'));
app.use('/autoavaliacoes', require('./routes/autoavaliacoes'));

app.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

// Handler de erro genérico — sempre por último.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ erro: err.expose ? err.message : 'Erro interno do servidor.' });
});

module.exports = app;
