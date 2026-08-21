# Validação — botão YouTube

- Ordem visual: Instagram → Facebook → YouTube → WhatsApp.
- Ícone: SVG reconhecível do YouTube.
- Acessibilidade: `aria-label`, foco visível e área mínima de toque de 44px.
- Responsividade: flex-wrap e breakpoint para telas estreitas.
- URL: não inventada. O botão somente fica ativo quando `CONTATO_YOUTUBE` contém uma URL HTTPS de `youtube.com` ou `youtu.be`.
- Enquanto não houver URL oficial configurada, o botão permanece visível, mas desabilitado e identificado como “YouTube — URL não configurada”.
