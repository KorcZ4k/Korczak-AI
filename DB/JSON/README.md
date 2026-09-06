# Banco de dados JSON da Korczak AI

O banco de chats usa JSON no servidor da API.

```text
DB/
└── JSON/
    ├── CHAT/
    │   └── CHATS.json
    ├── CHATS/
    │   ├── 001.json
    │   ├── 002.json
    │   └── ...
    └── AUDIT/
        └── events.jsonl
```

`CHAT/CHATS.json` é o índice global. Cada arquivo em `CHATS/` é isolado por usuário e contém:

- `id`: ID de três dígitos (`001`, `002`, ...).
- `nome`: nome do chat.
- `instrucoes`: instruções específicas.
- `modelo`: modelo Ollama usado.
- `memoria`: memória manual persistente.
- `memoria_automatica`: memória criada quando o usuário pede explicitamente para lembrar algo.
- `fontes`: arquivos de texto anexados ao chat.
- `fontes_web`: resultados de pesquisa web associados ao chat.
- `mensagens`: histórico da conversa.
- `usuario`: e-mail autenticado dono do chat.
- `preferencias`: opções do chat, incluindo pesquisa web.
- `metadata`: criação e última atualização.

A API nunca usa o arquivo JSON como fonte de autenticação. Login é validado exclusivamente na coleção `Users` do MongoDB, no banco `KorczakControl`, comparando a senha recebida com o hash bcrypt armazenado.

## Auditoria

`AUDIT/events.jsonl` registra eventos de autenticação, chats, pesquisa, guard rail e erros. O conteúdo das mensagens não é salvo no log; somente hashes curtos são usados para correlação.
