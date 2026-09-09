# Korczak AI

Aplicação web da Korczak AI com frontend estático, API Flask, autenticação MongoDB/bcrypt e inferência Ollama privada.

## Arquitetura

`Navegador → GitHub Pages → API Flask → MongoDB + Ollama`

O navegador **nunca** deve acessar Ollama diretamente. O endpoint do modelo fica exclusivamente no servidor da API.

## Configuração da API

Defina no ambiente do serviço backend:

- `APP_ENV=production`
- `MONGODB_URI` — conexão do MongoDB
- `MONGODB_DATABASE=KorczakControl`
- `MONGODB_COLLECTION=Users`
- `MONGODB_CHATS_COLLECTION=Chats`
- `MONGODB_AUDIT_COLLECTION=AuditEvents`
- `MONGODB_RATE_COLLECTION=RateLimits`
- `AUDIT_RETENTION_DAYS=90`
- `SECRET_KEY` — segredo aleatório longo e persistente
- `OLLAMA_BASE_URL` — URL privada do Ollama
- `FRONTEND_ORIGIN` — origem exata do frontend; não use `*` em produção
- `MODEL`, `MODEL_CONTEXT` e `MODEL_TEMPERATURE` conforme o servidor de inferência
- `AUTH_TOKEN_MAX_AGE`, `MAX_BODY_BYTES`, `LOGIN_RATE_LIMIT`, `CHAT_RATE_LIMIT`, `SEARCH_RATE_LIMIT` e `RATE_WINDOW` conforme a capacidade do serviço

A API falha no boot se os segredos ou endpoints obrigatórios não estiverem configurados em produção. Isso é intencional: configuração incompleta não deve parecer uma implantação saudável.

## Persistência

Chats, auditoria e rate limiting compartilhado usam MongoDB. O antigo armazenamento JSON foi removido do caminho de produção para evitar perda de dados em reinícios, múltiplas instâncias e deploys efêmeros.

Chats têm limites explícitos de tamanho, quantidade de mensagens, memórias, fontes e preferências. Isso evita crescimento ilimitado de documentos e contexto.

## Segurança

- tokens assinados com `SECRET_KEY` persistente;
- e-mail normalizado e índice único no MongoDB;
- bcrypt para senhas, incluindo verificação dummy para usuários inexistentes;
- limites de tamanho de requisição e de documentos persistidos;
- rate limiting compartilhado via MongoDB, compatível com múltiplos workers;
- guardrails de entrada e saída;
- defesa explícita contra prompt injection em contexto externo;
- auditoria sem armazenar texto bruto e com retenção configurável;
- Ollama não é publicado por GitHub Actions;
- GitHub Pages publica somente os arquivos do frontend;
- Content Security Policy no frontend;
- cabeçalhos HTTP de segurança na API;
- health check separado entre liveness e readiness;
- respostas do modelo são validadas antes de serem entregues;
- modelos selecionados por chat passam por validação de formato.

## Desenvolvimento

```bash
cp .env.example .env
# use APP_ENV=development, MongoDB local e Ollama local
python -m pip install -r api/requirements.txt
python -m compileall -q api tests
pytest -q
python api/app.py
```

## Produção

Use um serviço persistente para a API (por exemplo, Render) e um serviço privado/persistente para Ollama. Não use GitHub Actions runners como servidores permanentes.

O workflow de Pages constrói uma pasta `dist/` contendo apenas `index.html`, CSS, JavaScript e o background. Backend, banco, workflows e arquivos de configuração não são publicados.

O endpoint `/health/live` serve para liveness. O endpoint `/api/health` verifica MongoDB e Ollama e representa a prontidão real do backend.

## CI

Cada push e pull request para `main` executa compilação Python, validação JavaScript, testes de regressão/segurança e auditoria de dependências Python. Os workflows usam actions fixadas por SHA.
