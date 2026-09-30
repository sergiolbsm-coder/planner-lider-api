const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET não configurada. Defina uma string aleatória longa como variável de ambiente.');
}

// opts.somenteLeitura marca o token pro modo "Visualizar como" do admin —
// requireAuth abaixo bloqueia qualquer escrita feita com um token assim,
// não importa por qual rota, então nenhuma tela precisa saber que está em
// modo visualização pra ficar segura contra escrita por engano.
function assinarToken(user, opts = {}) {
  // liderId: o próprio id (se líder) ou o id do líder dono do quadro (se liderado).
  const liderId = user.role === 'lider' ? user.id : user.lider_id;
  // email vai no token pra dar pra listar/trocar entre as outras contas que
  // usam o mesmo e-mail (ex: admin que também é líder) sem pedir senha de novo.
  const payload = { id: user.id, role: user.role, liderId, turmaId: user.turma_id || null, nome: user.nome, email: user.email };
  if (opts.somenteLeitura) payload.somenteLeitura = true;
  return jwt.sign(payload, JWT_SECRET, { expiresIn: opts.expiresIn || '30d' });
}

const METODOS_ESCRITA = ['POST', 'PUT', 'PATCH', 'DELETE'];

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ erro: 'Token não enviado.' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    if (req.user.somenteLeitura && METODOS_ESCRITA.includes(req.method)) {
      return res.status(403).json({ erro: 'Modo de visualização é somente leitura.' });
    }
    next();
  } catch (err) {
    return res.status(401).json({ erro: 'Token inválido ou expirado.' });
  }
}

function requireLider(req, res, next) {
  if (req.user.role !== 'lider') {
    return res.status(403).json({ erro: 'Apenas o líder pode fazer isso.' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ erro: 'Apenas o administrador pode fazer isso.' });
  }
  next();
}

module.exports = { assinarToken, requireAuth, requireLider, requireAdmin };
