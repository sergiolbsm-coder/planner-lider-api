const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET não configurada. Defina uma string aleatória longa como variável de ambiente.');
}

function assinarToken(user) {
  // liderId: o próprio id (se líder) ou o id do líder dono do quadro (se liderado).
  const liderId = user.role === 'lider' ? user.id : user.lider_id;
  return jwt.sign(
    { id: user.id, role: user.role, liderId, nome: user.nome },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ erro: 'Token não enviado.' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
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

module.exports = { assinarToken, requireAuth, requireLider };
