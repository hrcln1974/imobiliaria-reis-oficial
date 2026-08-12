Pasta de mídia local (ignorada pelo Git).

public/uploads/imagens/  -> fotos dos imóveis, banner e foto do corretor
public/uploads/videos/   -> vídeos dos imóveis

Arquivos referenciados pela home e ainda não fornecidos ([IMAGEM PENDENTE]):
  - banner-alto-padrao.png
  - foto-corretor-v5.png

Enquanto os arquivos não existirem, a página exibe /img/placeholder.svg.
Em produção (DATABASE_URL + Vercel Blob) as mídias ficam no Vercel Blob.
