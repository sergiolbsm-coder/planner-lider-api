// Envio de e-mail transacional via Resend (https://resend.com) — API HTTP
// simples, sem SDK: um POST com fetch nativo (Node 18+) já resolve.
const RESEND_API_URL = 'https://api.resend.com/emails';

function template({ nome, email, senha, turmaNome, frontendUrl }) {
  const assunto = 'Seu acesso ao Planner do Líder — Instituto da Liderança';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1f2937;">
      <h2 style="color: #7c3aed;">Bem-vindo(a) ao Planner do Líder</h2>
      <p>Olá, ${nome}!</p>
      <p>Você foi cadastrado(a) como líder${turmaNome ? ` na turma <strong>${turmaNome}</strong>` : ''} no Planner do Líder do Instituto da Liderança.</p>
      <p>Seus dados de acesso:</p>
      <ul>
        <li><strong>E-mail:</strong> ${email}</li>
        <li><strong>Senha:</strong> ${senha}</li>
      </ul>
      <p style="margin-top: 24px;">
        <a href="${frontendUrl}" style="background: #7c3aed; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none;">Acessar o Planner</a>
      </p>
      <p style="font-size: 13px; color: #6b7280; margin-top: 24px;">Recomendamos trocar a senha após o primeiro acesso.</p>
    </div>
  `;
  return { assunto, html };
}

// Dispara o e-mail de convite. Nunca lança — falha de e-mail não deve
// impedir o cadastro do líder (que já foi persistido no banco antes desta
// chamada); quem chama decide se loga o erro ou ignora.
async function enviarConviteLider({ nome, email, senha, turmaNome }) {
  const apiKey = process.env.RESEND_API_KEY;
  const remetente = process.env.EMAIL_FROM;
  const frontendUrl = process.env.FRONTEND_URL || 'https://planner.institutodalideranca.com.br';

  if (!apiKey || !remetente) {
    console.warn('RESEND_API_KEY/EMAIL_FROM não configurados — pulando envio do e-mail de convite para', email);
    return { enviado: false, motivo: 'nao_configurado' };
  }

  const { assunto, html } = template({ nome, email, senha, turmaNome, frontendUrl });

  const resposta = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: remetente, to: email, subject: assunto, html }),
  });

  if (!resposta.ok) {
    const corpo = await resposta.text().catch(() => '');
    throw new Error(`Resend respondeu ${resposta.status}: ${corpo}`);
  }

  return { enviado: true };
}

module.exports = { enviarConviteLider };
