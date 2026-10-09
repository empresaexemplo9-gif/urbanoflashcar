# UrbanoFlashCar

Plataforma própria de **corridas urbanas** (MVP verificável). Implementação
original — não reutiliza marca, código ou credenciais de terceiros. O relatório
de investigação anexado ao projeto foi tratado como **hipótese**, não como
código recuperado (veja [`DELIVERIES.md`](./DELIVERIES.md)).

## O que já funciona (testado)

- **Contas e acesso** — cadastro, login, logout, sessão por token opaco
  (armazenado só como hash), senha com `scrypt`.
- **Solicitar e acompanhar corridas** — estimativa de tarifa (distância +
  tempo), solicitação, listagem, cancelamento.
- **Ciclo do motorista** — corridas disponíveis → aceitar → iniciar → concluir,
  com transições de estado validadas.
- **Pagamento direto ao motorista** — ao concluir a corrida, abre-se um
  pagamento pendente; o passageiro paga **direto ao motorista por Pix ou
  cartão físico (maquininha)** e o motorista confirma o recebimento no app.
- **Isolamento por conta** — um passageiro não vê nem altera a corrida de outro.
- **Continuidade de dados** — tudo persiste em SQLite e sobrevive a reinícios.

## Arquitetura (camadas com contrato explícito)

```
HTTP (public/ + src/lib/http.js)
  → rotas         src/app.js
    → serviços    src/services/*   (regras de negócio)
      → repositórios src/repositories/* (único lugar com SQL)
        → SQLite  src/db.js
```

Sem dependências externas: usa apenas módulos nativos do Node 22
(`node:sqlite`, `node:http`, `node:crypto`, `node:test`).

## Requisitos

- Node.js **>= 22.5** (o módulo `node:sqlite` é usado com `--experimental-sqlite`).

## Executar

```bash
npm start           # http://localhost:3000
npm run dev         # com --watch
```

Variáveis de ambiente úteis: `PORT`, `HOST`, `DATABASE_FILE`, `SESSION_TTL_MS`,
e o modelo de tarifa (`FARE_BASE_CENTS`, `FARE_PER_KM_CENTS`,
`FARE_PER_MIN_CENTS`, `FARE_MINIMUM_CENTS`, `FARE_AVG_SPEED_KMH`).

## Testar

```bash
npm test            # 37 testes: unidade (tarifa/geo) + integração (API/dados/permissões/pagamento) + PWA
```

## API

| Método | Rota | Descrição |
|---|---|---|
| GET  | `/api/health` | Verificação de saúde |
| POST | `/api/auth/register` | Criar conta (`rider`/`driver`) |
| POST | `/api/auth/login` | Autenticar, retorna token |
| POST | `/api/auth/logout` | Encerrar sessão |
| GET  | `/api/me` | Usuário atual |
| POST | `/api/estimate` | Estimar tarifa (sem criar corrida) |
| POST | `/api/rides` | Solicitar corrida (passageiro) |
| GET  | `/api/rides` | Minhas corridas |
| GET  | `/api/rides/available` | Corridas abertas (motorista) |
| GET  | `/api/rides/:id` | Detalhe (dono ou motorista designado) |
| POST | `/api/rides/:id/accept` | Motorista aceita |
| POST | `/api/rides/:id/start` | Motorista inicia |
| POST | `/api/rides/:id/complete` | Motorista conclui (abre o pagamento) |
| POST | `/api/rides/:id/cancel` | Passageiro ou motorista cancela |
| GET  | `/api/rides/:id/payment` | Estado do pagamento da corrida |
| POST | `/api/rides/:id/payment/confirm` | Motorista confirma recebimento (`{method: pix\|card}`) |

Erros seguem o formato `{ "error": { "code": "...", "message": "..." } }`.

## Instalar como aplicativo

### PWA (celular e desktop, qualquer sistema operacional)

A interface é uma **Progressive Web App** instalável — basta acessar o site:

- **Android / Chrome / Edge:** menu → "Instalar app" / "Adicionar à tela inicial".
- **iPhone / iPad (Safari):** Compartilhar → "Adicionar à Tela de Início".
- **Windows / macOS / Linux (Chrome/Edge):** ícone "Instalar" na barra de endereço, ou o botão **"Instalar app"** no topo da página.

Funciona offline para a casca do app (o conteúdo das corridas exige rede).
Requer HTTPS em produção (ou `localhost` em desenvolvimento).

Os ícones são gerados a partir de `assets/brand/taxi.webp` com `npm run icons`
(requer ImageMagick); os PNGs já ficam versionados em `public/icons/`.

### App de desktop (Electron) — Windows, macOS e Linux

O app de desktop embute o próprio servidor (dados ficam na pasta de dados do
usuário do sistema), então funciona sem configuração. Ele usa uma porta local
fixa (`31977`, configurável via `UFC_PORT`) e trava de instância única, para
manter uma origem estável — assim a sessão continua entre reinícios.
Alternativamente, aponte para um servidor hospedado com `UFC_SERVER_URL`.

```bash
npm install            # instala electron + electron-builder (devDependencies)
npm run desktop        # abre o app em uma janela nativa

# Gerar instaladores:
npm run desktop:build:linux   # AppImage + .deb   (gerável no Linux)
npm run desktop:build:win     # instalador .exe (NSIS) — gere no Windows
npm run desktop:build:mac     # .dmg — gere no macOS
```

Saída em `dist-desktop/`. Cada plataforma gera seu instalador na própria
plataforma (ou em CI); o build de Linux foi verificado neste projeto.

## Publicar (Docker)

```bash
docker build -t urbanoflashcar .
docker run -p 3000:3000 -v urbanoflashcar-data:/app/data urbanoflashcar
```

O volume preserva o banco entre implantações; `/api/health` serve de
_health check_. Veja `DELIVERIES.md` para o checklist de publicação.
