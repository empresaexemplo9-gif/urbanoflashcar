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
- **Tela inicial + rotas favoritas** — o passageiro salva rotas (origem→destino)
  e reusa num toque; tela separada para escolher origem/destino.
- **Motoristas próximos** — motoristas ficam "online" e compartilham localização;
  o passageiro vê os parceiros mais próximos (distância/ETA) antes de solicitar.
- **Ciclo do motorista** — corridas disponíveis → aceitar → iniciar → concluir,
  com transições de estado validadas.
- **Pagamento direto ao motorista** — ao concluir a corrida, abre-se um
  pagamento pendente; o passageiro paga **direto ao motorista por Pix ou
  cartão físico (maquininha)** e o motorista confirma o recebimento no app.
- **Isolamento por conta** — um passageiro não vê nem altera a corrida de outro.
- **Continuidade de dados** — tudo persiste em SQLite e sobrevive a reinícios.
- **Atualização automática** — o app instalado (PWA no celular/desktop e o app
  de desktop) acompanha a plataforma: ao publicar uma nova versão, os apps
  instalados se atualizam sozinhos, sem reinstalar.

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
o modelo de tarifa (`FARE_BASE_CENTS`, `FARE_PER_KM_CENTS`,
`FARE_PER_MIN_CENTS`, `FARE_MINIMUM_CENTS`, `FARE_AVG_SPEED_KMH`) e a
localização (`GEO_PHOTON_URL`, `GEO_IP_URL`, `GEO_TIMEOUT_MS`, `GEO_DISABLED`).

## Localização real (gratuita, sem chave)

Ao abrir **"Nova corrida"**, a origem é preenchida **automaticamente com a sua
localização atual e real** (GPS do dispositivo; se indisponível/negado, cai para
uma estimativa por IP — sem chave). Você pode ajustar no mapa, digitar ou usar
o botão **"Usar minha localização"**.

A tela usa **mapa real + autocomplete de endereços** com serviços **gratuitos e
sem API key**:

- **Mapa:** [Leaflet](https://leafletjs.com/) + tiles do
  [OpenStreetMap](https://www.openstreetmap.org/).
- **Busca/geocodificação de endereços:** [Photon](https://photon.komoot.io/)
  (projeto baseado em OSM).
- **Localização aproximada por IP:** [ipwho.is](https://ipwho.is/) (sem chave).

**O navegador só fala com o próprio app.** A busca de endereços, o reverse
geocoding e o fallback por IP passam por rotas **same-origin** (`/api/geo/*`) —
é o servidor que chama o Photon/IP, não o navegador. Isso resolve o caso comum
de "a localização não funciona": requisições a terceiros feitas pelo navegador
costumam ser bloqueadas por **ad-blockers / proteção contra rastreamento** ou
barradas por **CORS**; uma rota do próprio app não é. Além disso, o fallback
por IP usa o **IP real** que o servidor enxerga (respeitando `X-Forwarded-For`
atrás de um proxy reverso), em vez de depender de o navegador alcançar um
serviço externo.

> **GPS preciso exige contexto seguro.** O `navigator.geolocation` do navegador
> (a localização exata) só funciona em **HTTPS** ou em `localhost`. Servido por
> HTTP puro num IP/host da rede, o navegador bloqueia o GPS e o app usa o
> fallback por IP. Publique com HTTPS para ter a localização exata.

Não é preciso cadastro, cartão nem chave — funciona de imediato (inclusive no
app de desktop, cujo servidor embutido faz as chamadas de geo). Se os serviços/
Leaflet não carregarem (offline) ou com `GEO_DISABLED=1`, o app cai no modo de
**presets/coordenadas manuais**.

> **Uso em escala:** OSM/Photon são serviços públicos de uso justo. Para alto
> volume em produção, considere **auto-hospedar** o Photon/Nominatim e um
> servidor de tiles (ou um provedor) e apontar `GEO_PHOTON_URL`/`GEO_IP_URL`
> para eles, respeitando as políticas de uso do OSM.

## Testar

```bash
npm test            # 64 testes: unidade (tarifa/geo/geocoder) + integração (API/dados/permissões/pagamento/localização) + PWA + versão
```

## API

| Método | Rota | Descrição |
|---|---|---|
| GET  | `/api/health` | Verificação de saúde |
| GET  | `/api/version` | Versão da plataforma (usada pela atualização automática) |
| POST | `/api/auth/register` | Criar conta (`rider`/`driver`) |
| POST | `/api/auth/login` | Autenticar, retorna token |
| POST | `/api/auth/logout` | Encerrar sessão |
| GET  | `/api/me` | Usuário atual |
| POST | `/api/estimate` | Estimar tarifa (sem criar corrida) |
| GET  | `/api/geo/ip` | Localização aproximada pelo IP do cliente (fallback do GPS) |
| GET  | `/api/geo/search?q=` | Autocomplete de endereços (proxy do Photon/OSM) |
| GET  | `/api/geo/reverse?lat=&lng=` | Reverse geocoding de uma coordenada |
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
| GET  | `/api/favorites` | Rotas favoritas do usuário |
| POST | `/api/favorites` | Salvar rota favorita (`{label, pickup, dropoff}`) |
| DELETE | `/api/favorites/:id` | Remover rota favorita |
| POST | `/api/driver/location` | Motorista compartilha localização (`{lat, lng, available}`) |
| POST | `/api/driver/offline` | Motorista fica offline |
| GET  | `/api/drivers/nearby?lat=&lng=` | Motoristas parceiros próximos (distância/ETA) |

Erros seguem o formato `{ "error": { "code": "...", "message": "..." } }`.

## Instalar como aplicativo

### PWA (celular e desktop, qualquer sistema operacional)

A interface é uma **Progressive Web App** instalável — basta acessar o site:

- **Android / Chrome / Edge:** menu → "Instalar app" / "Adicionar à tela inicial".
- **iPhone / iPad (Safari):** Compartilhar → "Adicionar à Tela de Início".
- **Windows / macOS / Linux (Chrome/Edge):** ícone "Instalar" na barra de endereço, ou o botão **"Instalar app"** no topo da página.

Funciona offline para a casca do app (o conteúdo das corridas exige rede).
Requer HTTPS em produção (ou `localhost` em desenvolvimento).

**Atualização automática:** o `service worker` é servido com a versão da
plataforma embutida (rota `/sw.js`), então seus bytes mudam a cada versão e o
nome do cache (`ufc-shell-<versão>`) também. Quando você publica uma nova
versão, o navegador instala o novo worker, o app recarrega sozinho e passa a
usar a casca nova — o PWA instalado nunca fica numa versão velha. O rodapé
mostra a versão em uso (via `/api/version`).

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

**Atualização automática (desktop):** o app usa `electron-updater`. Ao abrir,
ele consulta as *GitHub Releases* do repositório; havendo uma versão mais
nova, baixa em segundo plano e instala ao sair. Assim o app de desktop — que
embute servidor + interface — acompanha a plataforma sem reinstalação manual.
Isso vale para o build empacotado/publicado (via o workflow de release); em
desenvolvimento (`npm run desktop`) a checagem fica desativada.

## Publicar (Docker)

```bash
docker build -t urbanoflashcar .
docker run -p 3000:3000 -v urbanoflashcar-data:/app/data urbanoflashcar
```

O volume preserva o banco entre implantações; `/api/health` serve de
_health check_. Veja `DELIVERIES.md` para o checklist de publicação.
