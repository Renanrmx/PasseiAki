# Testes, lint e build

## Testes

O projeto usa `node:test`, sem dependência extra de framework.

Comando:

```sh
npm test
```

O arquivo principal é `test/pure-functions.test.js`.

Os testes carregam scripts globais da extensão com `vm`, porque o código não usa módulos ES. Ao comparar objetos/arrays vindos do `vm`, use conversão para objeto simples quando necessário.

Áreas cobertas atualmente:

- normalização de domínio e URL;
- match parcial;
- plano de importação;
- exportação legível;
- validação de backup;
- normalização e migração de mirrors;
- busca textual por aliases;
- migração global de `www.`;
- exceções com aliases;
- `upsertVisit` legível e anonimizado;
- fallback em `Map()`.

## Checagem sintática

Para arquivos JS alterados:

```sh
node --check caminho/do/arquivo.js
```

Isso é útil porque muitos scripts são globais e podem quebrar no carregamento da extensão mesmo sem teste específico.

## Lint

Comando:

```sh
npm run lint
```

Ele executa:

- `npm run prepare:firefox`
- `web-ext lint --source-dir dist`
- validação customizada de manifest/referências do Chrome

Warnings conhecidos:

- compatibilidade de `strict_min_version` com `data_collection_permissions`;
- `UNSAFE_VAR_ASSIGNMENT` vindo de vendor minificado `iro.min.js`.

Se o número ou tipo de warnings mudar, investigue.

## Build

Comandos:

```sh
npm run build:firefox
npm run build:chrome
```

Ambos rodam `npm test` antes de preparar e empacotar.

`prepare:*` gera `dist/` copiando `src/` e escolhendo o manifest correto. Não edite `dist/` diretamente.

## Checklist antes de finalizar uma mudança

Para mudança pequena de docs:

- revisar diff;
- não é obrigatório rodar build.

Para mudança de JS:

- `node --check` nos arquivos alterados;
- `npm test`;
- `npm run lint`.

Para mudança de UI/locales:

- garantir chave em todos os locales;
- validar JSON dos locales;
- checar se textos longos não alargam popup/modal.

Para mudança em dados/migração/backup:

- adicionar ou atualizar testes;
- validar IndexedDB e fallback `Map()`;
- preservar compatibilidade de backup quando aplicável;
- não misturar registros anonimizados e legíveis.

