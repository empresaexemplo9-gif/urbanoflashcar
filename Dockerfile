# UrbanoFlashCar — imagem de produção. Sem dependências externas, então não há
# etapa de instalação: apenas o runtime do Node 22 e o código.
FROM node:22-alpine

WORKDIR /app

# Copia o código (ver .dockerignore para o que fica de fora).
COPY package.json ./
COPY src ./src
COPY public ./public

# Dados persistem aqui; monte um volume neste caminho em produção.
RUN mkdir -p /app/data
ENV DATABASE_FILE=/app/data/urbanoflashcar.db
ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000

# Health check usa o endpoint dedicado.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT||3000) +'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--experimental-sqlite", "src/server.js"]
