# Teste inicial — UrbanoFlashCar v0.1.3

Guia curto para o **primeiro teste** da plataforma. Tudo aqui foi validado ponta
a ponta por HTTP e por `npm test` (52/52).

> **Importante sobre dados:** nesta etapa **não há backend hospedado**. Cada
> forma de rodar sobe o **seu próprio servidor local** (dados por dispositivo).
> Para testar passageiro e motorista "se encontrando", rode os dois no **mesmo
> servidor** (mesma URL) — ex.: dois navegadores/abas apontando para o mesmo
> `localhost`, ou o app de desktop (que embute um servidor só).

## Como abrir a plataforma

### Opção A — Web / PWA (qualquer sistema)

```bash
npm start            # sobe em http://localhost:3000
```

Abra `http://localhost:3000`. Para instalar como app: no Chrome/Edge use o botão
**"Instalar app"** no topo (ou o ícone de instalar na barra de endereço); no
iPhone/Safari use Compartilhar → "Adicionar à Tela de Início".

Para simular **dois usuários** na mesma máquina, use uma aba normal e uma aba
anônima (sessões separadas) — ambas falam com o mesmo `localhost:3000`.

### Opção B — App de desktop (Windows / macOS / Linux)

Baixe o instalador da versão mais recente em
**Releases**: https://github.com/empresaexemplo9-gif/urbanoflashcar/releases

- Windows: `.exe` (NSIS)
- macOS: `.dmg`
- Linux: `.AppImage` ou `.deb`

O app embute o servidor (dados na pasta do usuário do sistema) e **se atualiza
sozinho** quando uma nova Release é publicada.

## Roteiro do teste (o que validar)

Crie **duas contas** (uma de cada perfil):

1. **Passageiro** — Criar conta → perfil "Passageiro".
2. **Motorista** — Criar conta → perfil "Motorista" (em outra aba/sessão).

Fluxo:

| # | Como | Esperado |
|---|---|---|
| 1 | **Motorista:** clicar em **"Ficar online"** e permitir a localização | status muda para online; a posição é compartilhada |
| 2 | **Passageiro (tela inicial):** ver **Rotas favoritas** e **Minhas corridas** | telas carregam vazias no começo |
| 3 | **Passageiro:** **+ Nova corrida** → escolher origem/destino (mapa gratuito, autocomplete ou presets) | pontos A/B marcados no mapa |
| 4 | **Passageiro:** **Motoristas próximos** | lista o motorista online com **distância/ETA** |
| 5 | **Passageiro:** **Estimar** | mostra a tarifa estimada |
| 6 | **Passageiro:** **Salvar rota favorita** | aparece na tela inicial; reusável num toque |
| 7 | **Passageiro:** **Solicitar corrida** | corrida criada com status "Solicitada" |
| 8 | **Motorista:** **Aceitar** → **Iniciar** → **Concluir** | status acompanha; ao concluir abre **pagamento pendente** |
| 9 | **Passageiro:** paga **direto ao motorista** (Pix ou cartão físico) | — |
| 10 | **Motorista:** **confirmar recebimento** (Pix/cartão) | pagamento vira "recebido" com o método |

Checagens rápidas de saúde (opcional, via terminal):

```bash
curl http://localhost:3000/api/health    # {"status":"ok",...}
curl http://localhost:3000/api/version   # {"version":"0.1.3"}
```

## Localização / mapa

Usa **Leaflet + OpenStreetMap + Photon** (grátis, sem chave). Precisa de internet
para o mapa e o autocomplete; sem internet, cai para **presets/coordenadas
manuais**. A geolocalização ("usar minha localização" / ficar online) depende da
permissão do navegador/SO.

## Limites conhecidos deste teste

- **Sem backend compartilhado:** passageiro e motorista em **dispositivos
  diferentes** não se veem (cada um tem seu servidor). Para esse cenário,
  hospede a plataforma (Render/Railway) e aponte os apps para a mesma URL
  (`UFC_SERVER_URL` no desktop; a Web já usa a própria origem).
- Pagamento é **direto ao motorista** (Pix/cartão físico); o app só registra e
  confirma — não processa dinheiro.
