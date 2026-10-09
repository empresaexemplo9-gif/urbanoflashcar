# Entregas verificáveis — UrbanoFlashCar

Este documento relaciona cada item do backlog a **o que foi implementado**, ao
**status da evidência** (requisito confirmado vs. hipótese) e ao **teste que o
verifica**. Nada é declarado "pronto" sem teste de interface, API e dados.

## Natureza das fontes

O dossiê anexado foi gerado por **análise estática** de páginas públicas da
App Store (listagem do app da Uber). Ele próprio afirma que:

- nenhuma jornada foi executada; JavaScript não foi avaliado;
- o backend, o esquema do banco e as regras privadas **não** foram observados;
- o conteúdo coletado é dado de terceiros e **não** deve ser copiado.

Portanto, o domínio "corridas urbanas" foi adotado como **hipótese de produto**
coerente com o nome do repositório (`urbanoflashcar`) e com a categoria do app
analisado (rides). O modelo de dados, os contratos e as regras aqui são
**implementação própria**, não reconstrução de um original.

## Rastreabilidade requisito → evidência → verificação

| Backlog | Status da fonte | Implementação | Verificação |
|---|---|---|---|
| **P006** Estrutura e manutenção | Proposta (sem evidência no escopo) | Camadas rotas→serviços→repositórios→DB; SQL isolado nos repositórios | Estrutura em `src/`; `npm test` roda antes de publicar |
| **P003** Contas e acesso | Proposta | Cadastro/login/logout, `scrypt`, sessão por hash de token | `test/auth.test.js` (8 casos) |
| **P003** Isolamento por conta | Proposta | Checagem de dono no serviço + escopo por id no repositório | `test/rides.test.js` → "isolation", "only the assigned driver" |
| **P002** Dados e continuidade | Proposta | Persistência em SQLite; sobrevive a reinício | `test/rides.test.js` + verificação manual de restart (ver abaixo) |
| **P005** Jornadas e navegação | Pistas estáticas; comportamento a validar | Jornada completa estimar→solicitar→acompanhar; UI web acessível | `test/rides.test.js` (ciclo completo) + UI em `public/` |
| **P009** Medir qualidade | Requisito de produto | Suíte de 39 testes (sucesso, erro, permissão); `/api/health` | `npm test` |
| **Instalável (PWA)** | Pedido do responsável | App web instalável em celular (Android/iOS) e desktop (Win/Mac/Linux): manifest, service worker, ícones | `test/pwa.test.js` (4 casos) |
| **Instalável (desktop)** | Pedido do responsável | App Electron que embute o servidor; instaladores AppImage + .deb gerados e verificados | Build + execução do binário empacotado |
| **P010** Publicar com recuperação | Requisito de produto | Dockerfile, volume de dados, health check, shutdown gracioso | `Dockerfile`, `src/server.js` |
| **P004** Pagamento (direto ao motorista) | Pedido do responsável | Pagamento **direto ao motorista por Pix ou cartão físico**: ao concluir abre pagamento pendente; o motorista confirma o recebimento com o método | `test/payments.test.js` (8 casos) |
| **P007** Compatibilidade do app | Proposta; **não** no escopo | — (o alvo é web; app nativo seria outra trilha) | — |
| **P008** Prototipar diferencial | Hipótese | — (requer comparação com alternativas reais e usuários) | — |
| **P001 / N001–N003** Validar com usuários | Requisito de descoberta | Não automatizável em código; depende de pesquisa com público | — |

Itens sem teste são explicitamente **fora do escopo deste MVP** e permanecem
como hipóteses a validar — não foram marcados como concluídos.

> **Sobre P004 (modelo de pagamento):** por enquanto o pagamento é **direto
> ao motorista** — Pix ou cartão físico (maquininha). O app não processa
> dinheiro: ele registra o pagamento como pendente ao concluir a corrida e o
> motorista confirma o recebimento (com o método). Integração com um provedor
> online (cobrança no app, split, antifraude, webhooks) continua sendo
> trabalho futuro.

## Verificações executadas nesta entrega

1. `npm test` → **39/39** testes passam (unidade + integração + pagamento + PWA).
2. Servidor real iniciado: `GET /api/health` responde `{"status":"ok"}`.
3. Estáticos servidos com `Content-Type` correto (`/`, `/app.js`).
4. Jornada ponta a ponta via HTTP: estimar → passageiro solicita → motorista
   aceita → inicia → conclui.
5. Isolamento: outro passageiro recebe **404** ao buscar corrida alheia.
6. Continuidade: após reiniciar o servidor sobre o mesmo arquivo SQLite, o
   histórico da corrida (status `completed`) permaneceu.
7. Pagamento: concluir a corrida abriu pagamento `pending`; o motorista
   designado confirmou o recebimento via Pix e via cartão (`received` + método);
   método inválido é rejeitado; confirmar duas vezes é bloqueado; só o motorista
   da corrida confirma; o resumo aparece na listagem.
8. PWA: manifest válido (`application/manifest+json`), service worker e ícones
   PNG servidos; `index.html` referencia manifest/ícones/theme-color.
9. Desktop (Electron): app roda em dev e empacotado; o binário empacotado subiu
   o servidor embutido (`node:sqlite` no Node 22.22 do Electron) e carregou a UI.
   Instaladores Linux gerados: `UrbanoFlashCar-0.1.0.AppImage` e
   `urbanoflashcar_0.1.0_amd64.deb`. Windows (.exe/NSIS) e macOS (.dmg) ficam
   configurados para build na respectiva plataforma (ou CI), não exercitados aqui.

## Checklist de publicação (P010)

- [x] Health check (`/api/health`).
- [x] Testes executam antes do build/publicação.
- [x] Dados em volume persistente (SQLite + WAL).
- [x] Encerramento gracioso (SIGINT/SIGTERM fecham servidor e banco).
- [ ] Ensaiar restauração de backup no ambiente real (depende de infraestrutura).
- [ ] Verificar interface, API e banco no ambiente publicado de produção.

## Perguntas em aberto (do plano, ainda válidas)

- Confirmar público-alvo e a jornada de maior valor com usuários reais.
- Validar estados vazios, erros e permissões em sessão autorizada de produção.
- Pagamento online no app (hoje é direto ao motorista por Pix/cartão físico):
  avaliar provedor, split e antifraude quando fizer sentido.
- Mapa/geocoder real: **integrado** via Google Maps (mapa + autocomplete +
  geolocalização) quando `GOOGLE_MAPS_API_KEY` está definido; sem a chave, cai
  para presets/coordenadas manuais. Falta a chave de produção (do responsável).
