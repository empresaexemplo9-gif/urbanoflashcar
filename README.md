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
- **Cobrança resiliente** — ao concluir a corrida, a tarifa é cobrada por um
  gateway simulado com idempotência (não cobra em dobro), tolerância a
  indisponibilidade/timeout e retentativa que preserva o trabalho.
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
npm test            # 35 testes: unidade (tarifa/geo/cobrança) + integração (API/dados/permissões)
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
| POST | `/api/rides/:id/complete` | Motorista conclui (gera a cobrança) |
| POST | `/api/rides/:id/cancel` | Passageiro ou motorista cancela |
| GET  | `/api/rides/:id/charge` | Estado da cobrança da corrida |
| POST | `/api/rides/:id/charge/retry` | Retentar cobrança que falhou |

Erros seguem o formato `{ "error": { "code": "...", "message": "..." } }`.

## Publicar (Docker)

```bash
docker build -t urbanoflashcar .
docker run -p 3000:3000 -v urbanoflashcar-data:/app/data urbanoflashcar
```

O volume preserva o banco entre implantações; `/api/health` serve de
_health check_. Veja `DELIVERIES.md` para o checklist de publicação.
