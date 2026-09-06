# Banco de dados JSON

Estrutura do banco local da Korczak AI:

```text
DB/
└── JSON/
    ├── CHAT/
    │   └── CHATS.json      # índice dos chats
    └── CHATS/
        ├── 001.json        # dados completos do chat 001
        ├── 002.json
        └── ...
```

Cada chat possui:

- `id`: identificador único com 3 dígitos.
- `nome`: nome exibido no sidebar.
- `instrucoes`: instruções específicas do chat.
- `modelo`: modelo Ollama usado pelo chat.
- `memoria`: informações persistentes daquele chat.
- `mensagens`: histórico da conversa.
- `metadata`: datas de criação e atualização.

O arquivo `CHAT/CHATS.json` funciona como índice e guarda os IDs, nomes e próximo ID disponível.
