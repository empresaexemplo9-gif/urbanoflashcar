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
| **P009** Medir qualidade | Requisito de produto | Suíte de 25 testes (sucesso, erro, permissão); `/api/health` | `npm test` |
| **P010** Publicar com recuperação | Requisito de produto | Dockerfile, volume de dados, health check, shutdown gracioso | `Dockerfile`, `src/server.js` |
| **P004** Integrações e sincronização | Proposta; **não** no escopo deste MVP | — (hipótese; sem integração externa adicionada para não inventar evidência) | — |
| **P007** Compatibilidade do app | Proposta; **não** no escopo | — (o alvo é web; app nativo seria outra trilha) | — |
| **P008** Prototipar diferencial | Hipótese | — (requer comparação com alternativas reais e usuários) | — |
| **P001 / N001–N003** Validar com usuários | Requisito de descoberta | Não automatizável em código; depende de pesquisa com público | — |

Itens sem teste são explicitamente **fora do escopo deste MVP** e permanecem
como hipóteses a validar — não foram marcados como concluídos.

## Verificações executadas nesta entrega

1. `npm test` → **25/25** testes passam (unidade + integração).
2. Servidor real iniciado: `GET /api/health` responde `{"status":"ok"}`.
3. Estáticos servidos com `Content-Type` correto (`/`, `/app.js`).
4. Jornada ponta a ponta via HTTP: estimar → passageiro solicita → motorista
   aceita → inicia → conclui.
5. Isolamento: outro passageiro recebe **404** ao buscar corrida alheia.
6. Continuidade: após reiniciar o servidor sobre o mesmo arquivo SQLite, o
   histórico da corrida (status `completed`) permaneceu.

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
- Definir integrações externas (pagamento, mapa/geocoder) antes de P004.
