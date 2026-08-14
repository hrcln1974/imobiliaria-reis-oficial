# Relatório V6.2.4

## Correção

A exclusão de fotos no PostgreSQL/Neon estava usando callbacks com `this.changes`/`this.lastID` sem preservar o contexto no adaptador de compatibilidade.

### Alterações
- `db-adapter.js`: callbacks do PostgreSQL agora preservam o contexto de execução.
- `server.js`: exclusão de imagens usa o resultado `changes` quando disponível e registra o erro real do banco.
- `dashboard.js`: mensagens de falha de exclusão passaram a informar o HTTP status quando necessário.
- Versão atualizada para 6.2.4.

## Hostinger

Com `DATABASE_URL` configurado e sem `BLOB_READ_WRITE_TOKEN`, o armazenamento de mídia permanece local em `public/uploads/imagens` e `public/uploads/videos`.
