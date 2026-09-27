-- ============================================================
-- Planner do Líder — esquema do banco (PostgreSQL / Neon)
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Turmas — cada turma é um grupo de líderes conduzido pelo administrador do
-- Instituto, com sua própria trilha de Desafios (ver desafios_itens abaixo).
CREATE TABLE IF NOT EXISTS turmas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Usuários: administrador, líderes e liderados compartilham a mesma tabela de
-- login. Um liderado sempre tem lider_id apontando pro líder dono do quadro;
-- um líder sempre tem turma_id apontando pra turma que o administrador
-- cadastrou ele (admin e liderado não usam turma_id).
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role TEXT NOT NULL CHECK (role IN ('admin', 'lider', 'liderado')),
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  lider_id UUID REFERENCES users(id) ON DELETE CASCADE,
  turma_id UUID REFERENCES turmas(id) ON DELETE SET NULL,
  area TEXT,
  cargo TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_lider_id ON users(lider_id);
CREATE INDEX IF NOT EXISTS idx_users_turma_id ON users(turma_id);
-- ALTERs separados porque "users" já existe em produção desde antes do papel
-- de administrador e da turma_id (mesmo motivo do ALTER de arquivos_aula.pasta).
ALTER TABLE users ADD COLUMN IF NOT EXISTS turma_id UUID REFERENCES turmas(id) ON DELETE SET NULL;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'lider', 'liderado'));

-- Perfil estendido do liderado — bloco "Conhecer o Liderado" do Diário de Bordo.
CREATE TABLE IF NOT EXISTS perfis_liderado (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data_inicio DATE,
  perfil_comportamental TEXT,
  habilidades TEXT,
  expectativas TEXT,
  metas_texto TEXT,
  desenvolvimento TEXT,
  obs TEXT,
  aspiracoes TEXT,
  comportamentos TEXT,
  sentimentos TEXT
);

-- Metas & Indicadores organizacionais.
CREATE TABLE IF NOT EXISTS metas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('estrategico', 'tatico', 'operacional')),
  indicador TEXT,
  valor TEXT,
  prazo DATE,
  descricao TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_metas_lider_id ON metas(lider_id);

-- Atividades / quadro Kanban.
CREATE TABLE IF NOT EXISTS atividades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  resultado TEXT NOT NULL,
  tipo TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'novo',
  prazo DATE,
  responsavel_eu BOOLEAN NOT NULL DEFAULT false,
  responsavel_id UUID REFERENCES users(id) ON DELETE SET NULL,
  meta_id UUID REFERENCES metas(id) ON DELETE SET NULL,
  obs TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_atividades_lider_id ON atividades(lider_id);
CREATE INDEX IF NOT EXISTS idx_atividades_responsavel_id ON atividades(responsavel_id);

-- Matriz de prioridade (resultado x esforço).
CREATE TABLE IF NOT EXISTS matriz_itens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  resultado TEXT NOT NULL,
  esforco TEXT NOT NULL,
  obs TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_matriz_lider_id ON matriz_itens(lider_id);

-- Diário de Bordo — registros do dia (observação ou feedback formal).
CREATE TABLE IF NOT EXISTS diario_registros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  liderado_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL DEFAULT 'observacao' CHECK (tipo IN ('observacao', 'feedback')),
  data DATE NOT NULL,
  riscos TEXT[] NOT NULL DEFAULT '{}',
  sinais TEXT,
  conversa TEXT,
  plano TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_diario_liderado_id ON diario_registros(liderado_id);
CREATE INDEX IF NOT EXISTS idx_diario_lider_id ON diario_registros(lider_id);

-- Dashboard — registro de rotina diária.
CREATE TABLE IF NOT EXISTS rotina_registros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data DATE NOT NULL,
  inicio TIME NOT NULL,
  fim TIME NOT NULL,
  atividade TEXT NOT NULL,
  tipo TEXT NOT NULL,
  impacto TEXT,
  energia TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rotina_lider_id ON rotina_registros(lider_id);

-- Dashboard — plano de ação (linhas editáveis da tabela).
CREATE TABLE IF NOT EXISTS plano_acao_itens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  acao TEXT,
  como_fazer TEXT,
  impacto TEXT,
  prazo TEXT,
  ordem INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_plano_acao_lider_id ON plano_acao_itens(lider_id);

-- Dashboard — configuração (alocação ideal), uma linha por líder.
-- checklist_erros/checklist_lider são de uma versão anterior (checklist fixo,
-- sempre visível) e ficaram sem uso — substituídos por "autoavaliacoes" abaixo,
-- que guarda uma resposta por mês e alimenta a análise de melhoria.
CREATE TABLE IF NOT EXISTS dashboard_config (
  lider_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ideal_operacional INT NOT NULL DEFAULT 30,
  ideal_tatico INT NOT NULL DEFAULT 40,
  ideal_estrategico INT NOT NULL DEFAULT 30,
  checklist_erros JSONB NOT NULL DEFAULT '{}',
  checklist_lider JSONB NOT NULL DEFAULT '{}'
);

-- Autoavaliação mensal do líder (os mesmos itens do antigo checklist fixo,
-- agora respondidos uma vez por mês) — base pra gerar a análise de melhoria.
CREATE TABLE IF NOT EXISTS autoavaliacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mes_ref TEXT NOT NULL, -- 'YYYY-MM'
  respostas JSONB NOT NULL DEFAULT '{}',
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lider_id, mes_ref)
);
CREATE INDEX IF NOT EXISTS idx_autoavaliacoes_lider_id ON autoavaliacoes(lider_id);

-- Desafios — trilha de passo a passo (checklist) de uma turma inteira.
-- É o TEMPLATE: título, descrição, seção-alvo, prazo e pontos, parametrizado
-- só pelo administrador (todo líder da turma segue a mesma trilha). O
-- progresso de cada líder fica em desafios_progresso, separado — "concluir no
-- prazo" é individual, a definição do desafio não é.
CREATE TABLE IF NOT EXISTS desafios_itens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  turma_id UUID NOT NULL REFERENCES turmas(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  descricao TEXT,
  secao_alvo TEXT,
  prazo DATE,
  pontos INT NOT NULL DEFAULT 10,
  ordem INT NOT NULL DEFAULT 0,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_desafios_itens_turma_id ON desafios_itens(turma_id);

-- Progresso individual de cada líder em cada desafio da trilha da sua turma.
-- Concluir até o "prazo" do desafio vale os pontos; depois disso vale 0 — mas
-- calculado no momento da leitura (não gravado aqui), pra não perder a conta
-- se o admin mudar o prazo do desafio depois.
CREATE TABLE IF NOT EXISTS desafios_progresso (
  desafio_id UUID NOT NULL REFERENCES desafios_itens(id) ON DELETE CASCADE,
  lider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  concluido BOOLEAN NOT NULL DEFAULT false,
  concluido_em TIMESTAMPTZ,
  PRIMARY KEY (desafio_id, lider_id)
);
CREATE INDEX IF NOT EXISTS idx_desafios_progresso_lider_id ON desafios_progresso(lider_id);

-- Plano de Gestão do líder — "Passo 1: Criação do Plano" do material oficial
-- (expectativas do ano, visão/missão, pontos fortes da equipe, metas do ano,
-- lema e combinados). Uma linha por líder, editável e reapresentável à equipe.
CREATE TABLE IF NOT EXISTS plano_gestao (
  lider_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  expectativas_ano TEXT,
  pontos_fortes_equipe TEXT,
  visao_missao TEXT,
  meta_desempenho TEXT,
  meta_processos TEXT,
  lema_do_ano TEXT,
  combinados TEXT,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Diagnóstico — brainstorm de Desafios e Oportunidades da equipe/área (2
-- colunas do material oficial), lista livre por líder.
CREATE TABLE IF NOT EXISTS diagnostico_itens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('desafio', 'oportunidade')),
  texto TEXT NOT NULL,
  ordem INT NOT NULL DEFAULT 0,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_diagnostico_itens_lider_id ON diagnostico_itens(lider_id);

-- Arquivos da aula — material que o administrador sobe pra turma (todo líder
-- dela baixa direto do site, sem precisar do Google Drive, que às vezes o
-- proxy da empresa bloqueia). Guardado como bytea no próprio Postgres: o
-- disco do Render é efêmero (some a cada deploy/restart), o banco não.
CREATE TABLE IF NOT EXISTS arquivos_aula (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  turma_id UUID NOT NULL REFERENCES turmas(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  descricao TEXT,
  pasta TEXT,
  tipo_mime TEXT NOT NULL,
  tamanho_bytes INT NOT NULL,
  conteudo BYTEA NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_arquivos_aula_turma_id ON arquivos_aula(turma_id);
