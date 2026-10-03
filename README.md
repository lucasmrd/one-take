# ONE TAKE

Uma experiência em plano-sequência que atravessa mundos — floresta, o olho de um urso, o espaço, um buraco negro, um mundo mágico, uma cidade cyberpunk, a órbita da Terra — numa única tomada, sem cortes, controlada pelo scroll do mouse.

Tudo é gerado por código, em tempo real, na GPU de quem assiste:

- **0 modelos 3D** — urso, lobo, cervo e baleia são esculpidos com campos de distância (SDF) e malhados no navegador; o pelo é renderizado em camadas (*shell fur*); a forma espiritual é feita de partículas na superfície do mesmo esqueleto.
- **0 texturas** — céu, nebulosa, íris, placa de circuito, janelas e nuvens são shaders procedurais.
- **0 arquivos de áudio** — vento, rio, uivos, o rugido, o ronco do buraco negro e o baixo da cidade são sintetizados com a Web Audio API.
- O site inteiro pesa ~200 KB (gzip).

## Rodar localmente

```bash
npm install
npm run dev
```

Abra http://localhost:5173 no Chrome/Edge (desktop, com aceleração de hardware ligada).

## Antes de publicar

Edite `src/config.js` com seu nome e seu GitHub — eles aparecem nos créditos finais.

## Publicar

```bash
npm run build
```

A pasta `dist/` é um site estático. Qualquer host serve:

- **Vercel**: importe o repositório; framework "Vite"; build `npm run build`; output `dist`.
- **Netlify**: build `npm run build`, publish `dist`.
- **GitHub Pages**: publique o conteúdo de `dist/` (o `base: './'` do `vite.config.js` já deixa os caminhos relativos).

Como tudo roda na GPU do visitante, o custo de servidor é zero, não importa quantas pessoas abram.

## Parâmetros de teste

| URL | efeito |
|---|---|
| `?skip&t=470` | pula a abertura e começa no ponto 470 da linha do tempo (0–1000) |
| `?auto=12` | piloto automático, avança 12 unidades por segundo |
| `?mute` | começa sem som |
| `?pr=0.7` | fixa a resolução interna (senão é adaptativa) |

No console, `OT.jump(u)` salta para qualquer ponto.

## Estrutura

```
src/
  main.js            motor: linha do tempo, render de dois mundos + transição, pós-processamento
  timeline.js        o roteiro: mundos, transições, legendas, eventos de som
  animals/           anatomia (SDF + esqueleto), pelo, partículas espirituais, holograma, runas
  worlds/            forest · eye · space · magic · city · orbit
  core/              scroll com inércia, pós (transições, raios de luz, grão), névoa, ruído, áudio
  ui/overlay.js      abertura, legendas, créditos com o relatório da GPU
```
