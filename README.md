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
- `SECRET_KEY` — segredo aleatório longo e persistente
- `OLLAMA_BASE_URL` — URL privada do Ollama
- `FRONTEND_ORIGIN` — origem exata do frontend; não use `*` em produção
- `MODEL`, `MODEL_CONTEXT` e `MODEL_TEMPERATURE` conforme o servidor de inferência

A API falha no boot se os segredos ou endpoints obrigatórios não estiverem configurados em produção. Isso é intencional: configuração incompleta não deve parecer uma implantação saudável.

## Persistência

Chats e auditoria usam MongoDB. O antigo armazenamento JSON foi removido do caminho de produção para evitar perda de dados em reinícios, múltiplas instâncias e deploys efêmeros.

## Segurança

- tokens assinados com `SECRET_KEY` persistente;
- e-mail normalizado e índice único no MongoDB;
- bcrypt para senhas;
- limites de tamanho de requisição;
- rate limiting para login, chat e pesquisa;
- guardrails de entrada e saída;
- auditoria sem armazenar texto bruto;
- Ollama não é publicado por GitHub Actions;
- GitHub Pages publica somente os arquivos do frontend;
- Content Security Policy no frontend;
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

## CI

Cada push e pull request para `main` executa compilação Python e testes de regressão. O branch `hardening/excellence` também executa CI para permitir validação antes do merge.
