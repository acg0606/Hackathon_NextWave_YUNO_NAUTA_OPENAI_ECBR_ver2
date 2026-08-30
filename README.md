# RouteShift — NextWave 2026 · Projeto Individual

Protótipo interativo da trilha 3: o usuário compra uma entrega, aciona uma disrupção histórica como se ela ocorresse hoje e acompanha a interface operacional se recompor até a última milha.

## Limite deste repositório

Este é o repositório local da versão individual do RouteShift. Ele é independente do repositório compartilhado da equipe `Hackathon-Nextwave-YUNO-NAUTA-OPENAI-ECBR` e não deve ser usado para commits ou pushes destinados ao trabalho coletivo.

Publicação no Sites e criação de qualquer remoto devem ser tratadas separadamente e somente quando forem autorizadas de forma explícita.

## Executar localmente

Pré-requisito: Node.js 22.13+ e pnpm.

```powershell
$env:ROUTESHIFT_NODE_PREVIEW='1'
pnpm install
pnpm dev -- --port 4388
```

Abra `http://localhost:4388/`.

Validação de produção:

```powershell
pnpm exec oxlint app/page.tsx app/LiveEarth.tsx app/scenarios.ts
pnpm exec tsc --noEmit
pnpm build
```

## O que demonstrar

1. Monte uma entrega na superfície de compra.
2. Abra o arquivo e escolha um dos 10 casos históricos resolvidos.
3. Compre a entrega e acione o incidente “como se fosse hoje”.
4. Compare fato histórico, contexto NASA atual e simulação.
5. Escolha entre manter o plano sob vigilância ou autorizar uma nova rota; cada decisão abre uma interface diferente.
6. Conclua a última milha e abra a fonte histórica no recibo.

## Dados e limites

- O globo WebGL usa MapLibre GL e o mosaico Blue Marble da NASA GIBS.
- O contexto atual consulta eventos abertos no NASA EONET e conta IDs de eventos únicos dos últimos 20 dias.
- EONET é contexto global atual; não prova impacto causal na rota simulada.
- Recomendações, ETA, custos e decisões “se fosse hoje” são simulações.
- Yuno e Nauta estão identificados na interface como `CONECTOR MOCK`.
- As coordenadas dos eventos são âncoras visuais aproximadas para a narrativa.

## Estrutura principal

- `app/page.tsx`: jornada e superfícies mutáveis.
- `app/LiveEarth.tsx`: globo, rotas e contexto EONET.
- `app/scenarios.ts`: 10 casos e fontes históricas.
- `app/globals.css`: direção visual e responsividade.
- `PRODUCT.md` e `DESIGN.md`: narrativa, escopo e decisões de design.
