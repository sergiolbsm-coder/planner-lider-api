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
  email TEXT NOT NULL,
  senha_hash TEXT NOT NULL,
  lider_id UUID REFERENCES users(id) ON DELETE CASCADE,
  turma_id UUID REFERENCES turmas(id) ON DELETE SET NULL,
  area TEXT,
  cargo TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_lider_id ON users(lider_id);
-- ALTERs separados porque "users" já existe em produção desde antes do papel
-- de administrador e da turma_id (mesmo motivo do ALTER de arquivos_aula.pasta)
-- — por isso vêm ANTES do CREATE INDEX de turma_id: numa tabela já existente,
-- o CREATE TABLE IF NOT EXISTS acima é ignorado inteiro, então a coluna só
-- passa a existir de fato aqui.
ALTER TABLE users ADD COLUMN IF NOT EXISTS turma_id UUID REFERENCES turmas(id) ON DELETE SET NULL;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'lider', 'liderado'));
CREATE INDEX IF NOT EXISTS idx_users_turma_id ON users(turma_id);
-- A mesma pessoa (mesmo e-mail) pode ser líder em mais de uma turma — por
-- exemplo o próprio administrador testando como líder, ou alguém que
-- coordena duas turmas. Por isso a unicidade de e-mail deixou de ser global
-- (era "users_email_key", da versão original da tabela) e passou a ser por
-- (email, turma_id): mesmo e-mail não pode repetir DENTRO da mesma turma,
-- mas pode existir em turmas diferentes. Como o Postgres nunca considera
-- dois NULLs iguais numa unique constraint, isso também libera o e-mail do
-- admin (turma_id sempre NULL) para ser reaproveitado como líder — o que é
-- seguro porque só existe um admin (bloqueado à parte em /auth/bootstrap-admin,
-- pela existência do papel, não pelo e-mail).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_turma ON users(email, turma_id);
-- E-mail/senha de acesso do liderado passaram a ser opcionais no cadastro —
-- o líder pode registrar só o perfil (nome, cargo, etc.) e liberar o acesso
-- depois. Continuam obrigatórios pra admin/líder (aplicado na camada da
-- aplicação, não aqui) — e o índice único acima já não se importa com
-- múltiplos e-mails NULL (o Postgres nunca considera dois NULLs iguais).
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ALTER COLUMN senha_hash DROP NOT NULL;

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
-- Campos do "Painel do Líder" oficial (material de aula): 1. Direção e
-- Objetivo (porque_importa), 2. Meta e Medição completa (ponto_partida +
-- frequência, complementando indicador/valor/prazo que já existiam),
-- 3. Mini-BSC (perspectiva_bsc — uma por meta, não as 4 juntas: o Dashboard
-- agrega várias metas por perspectiva pra formar a visão de conjunto),
-- 4. OKR (objetivo + até 3 KRs) e 5. Execução e Acompanhamento. Tudo
-- opcional — os campos antigos continuam funcionando sozinhos pra quem só
-- quer uma meta simples.
ALTER TABLE metas ADD COLUMN IF NOT EXISTS porque_importa TEXT;
ALTER TABLE metas ADD COLUMN IF NOT EXISTS ponto_partida TEXT;
ALTER TABLE metas ADD COLUMN IF NOT EXISTS frequencia_acompanhamento TEXT;
ALTER TABLE metas DROP CONSTRAINT IF EXISTS metas_frequencia_acompanhamento_check;
ALTER TABLE metas ADD CONSTRAINT metas_frequencia_acompanhamento_check
  CHECK (frequencia_acompanhamento IS NULL OR frequencia_acompanhamento IN ('semanal', 'quinzenal', 'mensal', 'trimestral'));
ALTER TABLE metas ADD COLUMN IF NOT EXISTS perspectiva_bsc TEXT;
ALTER TABLE metas DROP CONSTRAINT IF EXISTS metas_perspectiva_bsc_check;
ALTER TABLE metas ADD CONSTRAINT metas_perspectiva_bsc_check
  CHECK (perspectiva_bsc IS NULL OR perspectiva_bsc IN ('aprendizado', 'processos', 'clientes', 'financeira'));
ALTER TABLE metas ADD COLUMN IF NOT EXISTS okr_objetivo TEXT;
ALTER TABLE metas ADD COLUMN IF NOT EXISTS okr_kr1 TEXT;
ALTER TABLE metas ADD COLUMN IF NOT EXISTS okr_kr2 TEXT;
ALTER TABLE metas ADD COLUMN IF NOT EXISTS okr_kr3 TEXT;
ALTER TABLE metas ADD COLUMN IF NOT EXISTS acao_prioritaria TEXT;
ALTER TABLE metas ADD COLUMN IF NOT EXISTS responsavel_acao TEXT;
ALTER TABLE metas ADD COLUMN IF NOT EXISTS evidencia_conclusao TEXT;
ALTER TABLE metas ADD COLUMN IF NOT EXISTS proxima_verificacao DATE;
ALTER TABLE metas ADD COLUMN IF NOT EXISTS status_execucao TEXT NOT NULL DEFAULT 'no_prazo';
ALTER TABLE metas DROP CONSTRAINT IF EXISTS metas_status_execucao_check;
ALTER TABLE metas ADD CONSTRAINT metas_status_execucao_check
  CHECK (status_execucao IN ('no_prazo', 'atencao', 'atrasado', 'concluido'));

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
-- Matriz de Prioridade passou a admitir cadastro por liderado (mesmo padrão
-- responsavel_eu/responsavel_id de atividades e plano_acao_itens), pro líder
-- conseguir ver tanto a matriz de cada pessoa quanto a visão agregada da
-- área inteira. Default responsavel_eu=true preserva os itens já existentes
-- como sendo do próprio líder.
ALTER TABLE matriz_itens ADD COLUMN IF NOT EXISTS responsavel_eu BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE matriz_itens ADD COLUMN IF NOT EXISTS responsavel_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_matriz_responsavel_id ON matriz_itens(responsavel_id);

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
-- Evolução — contraponto positivo da checagem de riscos psicossociais (mesmo
-- padrão de múltipla escolha), pra registrar também o que está indo bem, não
-- só os alertas.
ALTER TABLE diario_registros ADD COLUMN IF NOT EXISTS evolucao TEXT[] NOT NULL DEFAULT '{}';
-- Feedback formal — 3 ferramentas do material de aula. Cada uma tem seus
-- próprios campos porque pedem preenchimentos diferentes (Sanduíche é
-- positivo/melhoria/positivo; Feedforward é + e Delta; Comece-Pare-Continue
-- são 3 blocos distintos) — misturar tudo em "conversa"/"plano" perderia a
-- estrutura que a ferramenta escolhida exige.
ALTER TABLE diario_registros ADD COLUMN IF NOT EXISTS ferramenta_feedback TEXT;
ALTER TABLE diario_registros DROP CONSTRAINT IF EXISTS diario_registros_ferramenta_feedback_check;
ALTER TABLE diario_registros ADD CONSTRAINT diario_registros_ferramenta_feedback_check
  CHECK (ferramenta_feedback IS NULL OR ferramenta_feedback IN ('sanduiche', 'feedforward', 'comece_pare_continue'));
ALTER TABLE diario_registros ADD COLUMN IF NOT EXISTS fb_sanduiche_positivo1 TEXT;
ALTER TABLE diario_registros ADD COLUMN IF NOT EXISTS fb_sanduiche_melhoria TEXT;
ALTER TABLE diario_registros ADD COLUMN IF NOT EXISTS fb_sanduiche_positivo2 TEXT;
ALTER TABLE diario_registros ADD COLUMN IF NOT EXISTS fb_feedforward_mais TEXT;
ALTER TABLE diario_registros ADD COLUMN IF NOT EXISTS fb_feedforward_delta TEXT;
ALTER TABLE diario_registros ADD COLUMN IF NOT EXISTS fb_cpc_comece TEXT;
ALTER TABLE diario_registros ADD COLUMN IF NOT EXISTS fb_cpc_pare TEXT;
ALTER TABLE diario_registros ADD COLUMN IF NOT EXISTS fb_cpc_continue TEXT;

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
-- Plano de Ação evoluiu pro modelo "Projetos/Iniciativas" (planejamento) +
-- "Acompanhamento de Planos por Equipe" (execução) do material oficial:
-- cada linha pode se vincular a um responsável (liderado ou o próprio
-- líder, mesmo padrão de atividades.responsavel_eu/responsavel_id) e a uma
-- meta, além de ganhar os campos de planejamento (equipe/áreas, recursos,
-- checkpoints) e de acompanhamento (datas, status, lições aprendidas).
ALTER TABLE plano_acao_itens ADD COLUMN IF NOT EXISTS responsavel_eu BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE plano_acao_itens ADD COLUMN IF NOT EXISTS responsavel_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE plano_acao_itens ADD COLUMN IF NOT EXISTS meta_id UUID REFERENCES metas(id) ON DELETE SET NULL;
ALTER TABLE plano_acao_itens ADD COLUMN IF NOT EXISTS equipe_areas TEXT;
ALTER TABLE plano_acao_itens ADD COLUMN IF NOT EXISTS recursos TEXT;
ALTER TABLE plano_acao_itens ADD COLUMN IF NOT EXISTS checkpoints TEXT;
ALTER TABLE plano_acao_itens ADD COLUMN IF NOT EXISTS data_inicio DATE;
ALTER TABLE plano_acao_itens ADD COLUMN IF NOT EXISTS data_fim DATE;
ALTER TABLE plano_acao_itens ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'novo';
ALTER TABLE plano_acao_itens DROP CONSTRAINT IF EXISTS plano_acao_itens_status_check;
ALTER TABLE plano_acao_itens ADD CONSTRAINT plano_acao_itens_status_check CHECK (status IN ('novo', 'andamento', 'bloqueado', 'concluido'));
ALTER TABLE plano_acao_itens ADD COLUMN IF NOT EXISTS licoes_aprendidas TEXT;
CREATE INDEX IF NOT EXISTS idx_plano_acao_responsavel_id ON plano_acao_itens(responsavel_id);
CREATE INDEX IF NOT EXISTS idx_plano_acao_meta_id ON plano_acao_itens(meta_id);

-- Projetos/Iniciativas — planejamento (Passo 5, item 1 do material: nome,
-- meta vinculada, equipe/áreas, recursos, checkpoints). Virou uma entidade
-- própria, separada do Plano de Ação: antes as duas telas ("Projetos/
-- Iniciativas" e "Acompanhamento") editavam a MESMA linha de
-- plano_acao_itens, dando a impressão de que o Plano de Ação era "puxado"
-- dos projetos — agora são duas listas independentes, sem vínculo 1:1
-- obrigatório entre uma coisa e outra.
CREATE TABLE IF NOT EXISTS projetos_iniciativas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nome TEXT,
  meta_id UUID REFERENCES metas(id) ON DELETE SET NULL,
  equipe_areas TEXT,
  recursos TEXT,
  checkpoints TEXT,
  ordem INT NOT NULL DEFAULT 0,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_projetos_lider_id ON projetos_iniciativas(lider_id);
CREATE INDEX IF NOT EXISTS idx_projetos_meta_id ON projetos_iniciativas(meta_id);

-- Vínculo da atividade com o planejamento: além de uma Meta/Indicador (já
-- existia via meta_id), a atividade agora também pode declarar que está
-- contribuindo especificamente pra um OKR ou uma perspectiva do BSC — ambos
-- guardados na própria linha de metas (ver ALTERs de metas acima), então
-- 'meta'/'okr'/'bsc' reusam o mesmo meta_id, só muda o enquadramento
-- escolhido pelo líder — ou pra um item do Plano de Ação do Dashboard
-- (tabela diferente, por isso tem sua própria coluna). Vem depois de
-- plano_acao_itens no arquivo porque a FK abaixo depende dela já existir.
ALTER TABLE atividades ADD COLUMN IF NOT EXISTS tipo_vinculo TEXT;
ALTER TABLE atividades DROP CONSTRAINT IF EXISTS atividades_tipo_vinculo_check;
ALTER TABLE atividades ADD CONSTRAINT atividades_tipo_vinculo_check
  CHECK (tipo_vinculo IS NULL OR tipo_vinculo IN ('meta', 'okr', 'bsc', 'plano_acao'));
ALTER TABLE atividades ADD COLUMN IF NOT EXISTS plano_acao_id UUID REFERENCES plano_acao_itens(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_atividades_plano_acao_id ON atividades(plano_acao_id);

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
-- de_onde_viemos..para_onde_vamos são a "Ferramenta Avião" (Passo 3 —
-- Apresentação): as 5 perguntas de alinhamento organizacional, preenchidas
-- na aba de apresentação e usadas na hora de alinhar a equipe com o plano.
CREATE TABLE IF NOT EXISTS plano_gestao (
  lider_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  expectativas_ano TEXT,
  pontos_fortes_equipe TEXT,
  visao_missao TEXT,
  meta_desempenho TEXT,
  meta_processos TEXT,
  lema_do_ano TEXT,
  combinados TEXT,
  de_onde_viemos TEXT,
  como_nos_guiamos TEXT,
  para_quem_valor TEXT,
  o_que_da_poder TEXT,
  para_onde_vamos TEXT,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE plano_gestao ADD COLUMN IF NOT EXISTS de_onde_viemos TEXT;
ALTER TABLE plano_gestao ADD COLUMN IF NOT EXISTS como_nos_guiamos TEXT;
ALTER TABLE plano_gestao ADD COLUMN IF NOT EXISTS para_quem_valor TEXT;
ALTER TABLE plano_gestao ADD COLUMN IF NOT EXISTS o_que_da_poder TEXT;
ALTER TABLE plano_gestao ADD COLUMN IF NOT EXISTS para_onde_vamos TEXT;

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
  turma_id UUID REFERENCES turmas(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  descricao TEXT,
  pasta TEXT,
  tipo_mime TEXT NOT NULL,
  tamanho_bytes INT NOT NULL,
  conteudo BYTEA NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- turma_id vira legado (fica nulo pra sempre em arquivos novos) porque um
-- mesmo arquivo agora pode estar vinculado a várias turmas — ver
-- arquivo_turmas logo abaixo, que é quem manda de verdade.
ALTER TABLE arquivos_aula ALTER COLUMN turma_id DROP NOT NULL;

-- Vínculo N:N entre arquivo e turma: dá pra copiar/vincular a mesma pasta ou
-- arquivo em mais de uma turma sem duplicar o conteúdo (bytea) — só a linha
-- de vínculo é nova.
CREATE TABLE IF NOT EXISTS arquivo_turmas (
  arquivo_id UUID NOT NULL REFERENCES arquivos_aula(id) ON DELETE CASCADE,
  turma_id UUID NOT NULL REFERENCES turmas(id) ON DELETE CASCADE,
  PRIMARY KEY (arquivo_id, turma_id)
);
CREATE INDEX IF NOT EXISTS idx_arquivo_turmas_turma_id ON arquivo_turmas(turma_id);

-- Migra vínculos antigos (de quando só existia arquivos_aula.turma_id) pra
-- tabela nova. Idempotente: depois da primeira vez, todo arquivo_id já com
-- vínculo cai no ON CONFLICT DO NOTHING; arquivos novos nascem com turma_id
-- NULL (o app já não usa mais essa coluna pra gravar), então não entram aqui.
INSERT INTO arquivo_turmas (arquivo_id, turma_id)
SELECT id, turma_id FROM arquivos_aula WHERE turma_id IS NOT NULL
ON CONFLICT DO NOTHING;
