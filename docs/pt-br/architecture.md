# Arquitetura da extensão

Passei Aki é uma extensão de navegador que registra acessos localmente e marca links já visitados ou parcialmente semelhantes.

O código principal fica em `src/`. O diretório `dist/` é gerado por `scripts/prepare-dist.mjs` e não deve ser editado diretamente.

## Estrutura principal

- `src/worker/`: service worker/background. Concentra persistência, matching, histórico, backup, importação/exportação, downloads, suporte e handlers de mensagens.
- `src/content/highlighter.js`: content script injetado nas páginas. Coleta links, consulta o background e aplica classes/estilos de visitado ou parcial.
- `src/panel/`: páginas da extensão, como popup principal, configurações, histórico, mirrors e exceções.
- `src/shared/`: helpers globais compartilhados entre contextos.
- `src/_locales/*/messages.json`: textos localizados.
- `test/`: testes em Node usando `node:test`.

## Modelo de scripts

O projeto usa scripts globais de extensão, não módulos ES. Isso significa que:

- a ordem de carregamento importa;
- funções globais são compartilhadas no mesmo contexto;
- testes carregam scripts com `vm` para simular esse comportamento;
- antes de mover funções entre arquivos, confirme se todas as páginas/manifests carregam a nova dependência.

## Fluxo principal de uma visita

1. O background recebe eventos de navegação/aba.
2. A URL é normalizada e transformada em fingerprint.
3. O registro é salvo ou mesclado via `upsertVisit`.
4. O estado da ação/ícone é atualizado.
5. O content script pode consultar links da página para saber quais devem ser marcados.

Arquivos relevantes:

- `src/worker/background.js`
- `src/worker/background.match.js`
- `src/worker/background.database.js`
- `src/content/highlighter.js`

## Mensagens internas

Os tipos de mensagem ficam em `src/shared/messages.js`. Sempre que uma nova mensagem for criada:

- adicione o tipo em `AKI_MESSAGE_TYPES`;
- permita o tipo no conjunto correto em `background.js`;
- valide se a mensagem deve ser acessível por página da extensão, content script ou ambos;
- retorne `{ ok: true }` ou `{ ok: false, error }` quando o chamador espera estado de sucesso/falha.

## UI

As páginas de painel usam HTML/CSS/JS simples. O helper `src/panel/i18n.js` aplica `data-i18n` e `data-i18n-attr`.

Ao adicionar texto visível:

- crie chave em todos os locales;
- evite strings fixas apenas no JS/HTML, exceto fallback visual;
- confira se textos longos não expandem a largura da popup.

