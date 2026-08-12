# Relatório V6.1.0 — Imobiliária Fabiano Reis

## Correções aplicadas

- Removida a criação automática de usuário corretor no startup.
- Removidos seeds fictícios do fluxo de inicialização.
- `database.db` local não é distribuído no release.
- `.gitignore` passou a ignorar bancos SQLite e uploads locais.
- Criado `npm run admin:create` para provisionamento explícito do corretor.
- CORS passou a respeitar `CORS_ORIGIN`.
- Cookie de autenticação usa `HttpOnly` e `Secure` em produção.
- Login valida entrada e usa resposta genérica para credenciais inválidas.
- Upload de produção usa Vercel Blob direto pelo navegador.
- Criada rota específica para registrar imagens já enviadas ao Blob.
- Upload direto de Blob valida o imóvel informado no payload.
- Rota genérica de mídia que permitia `imovel_id` arbitrário foi removida.
- Mantidos os fluxos locais com SQLite e upload tradicional para desenvolvimento.

## Fluxo de produção

Browser → Vercel Blob → URL → API autenticada → Neon

O banco não armazena arquivos; armazena apenas os metadados e URLs.

## Provisionamento

Configure `DATABASE_URL`, `ADMIN_EMAIL` e `ADMIN_PASSWORD` em um ambiente seguro e execute:

```bash
npm run admin:create
```

Não coloque a senha do administrador no código-fonte ou no Git.
