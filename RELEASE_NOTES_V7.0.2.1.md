# Fabiano Reis Imóveis — V7.0.2.1

## Alterações
- Alteração de senha pelo próprio corretor no painel.
- Nova senha: 12 a 200 caracteres.
- Verificação da senha atual.
- Hash bcrypt com custo 12.
- Renovação do cookie JWT após alteração.
- Mensagens prontas de WhatsApp na página pública de cada imóvel.

## Mensagens WhatsApp
- Tenho interesse
- Agendar visita
- Condições de pagamento
- Mais fotos

## Implantação Hostinger
Não executar limpeza do banco. Não executar migração de dados.
Fazer backup antes da substituição do código e reiniciar a aplicação após o deploy.

Opcional: definir `WHATSAPP_NUMBER` no `.env` com DDI + DDD + número, somente dígitos.
