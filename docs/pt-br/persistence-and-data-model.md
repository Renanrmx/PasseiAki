# Persistência, privacidade e modelo de dados

O histórico do usuário é armazenado localmente. Não há envio de dados para servidor.

## IndexedDB e fallback em memória

O armazenamento principal é IndexedDB, implementado em `src/worker/background.database.js`.

Quando o navegador bloqueia escrita persistente, o projeto marca o banco como bloqueado e usa `Map()` em memória:

- `memoryVisits`
- `memoryMeta`
- stores em memória para exceções
- `mirrorGroupsMemory` em `background.mirrors.js`

Esse fallback é temporário. Os dados são perdidos ao fechar a aplicação/processo da extensão.

A popup principal consulta `GET_PERSISTENCE_STATUS` e mostra aviso quando `memoryOnly === true`.

## Stores principais

Stores IndexedDB:

- `visits`: registros de acesso.
- `meta`: configurações, pepper e totais agregados.
- `partial_exceptions`: exceções de match parcial.
- `match_exceptions`: exceções de match completo.
- `mirror_groups`: grupos de mirrors/aliases.

## Registro de visita

Campos relevantes:

- `id`: identidade única do registro.
- `hostHash`, `pathHash`, `queryHash`, `fragmentHash`: chaves usadas em busca/match.
- `queryParamsHash`: lista dos parâmetros normalizados/hasheados.
- `hashed`: quando diferente de `false`, o registro é tratado como anonimizado.
- `host`, `path`, `query`, `fragment`: campos legíveis quando disponíveis.
- `lastVisited`: timestamp do último acesso.
- `visitCount`: número de acessos.
- `download`: indica acesso oriundo de download.

## Modo legível vs anonimizado

Quando a anonimização está desativada, o registro mantém `host`, `path`, `query` e `fragment` legíveis.

Quando está ativada, as partes usadas para identidade são HMAC-SHA512 com pepper local. O pepper fica em `meta`.

Regra crítica: não mesclar registros anonimizados e não anonimizados na mesma operação. Se houver colisão entre modelos de privacidade, a operação deve preservar os dados originais ou abortar.

## Totais agregados

Totais são guardados em `meta`:

- `statsTotalEntries`
- `statsTotalVisits`

Operações que adicionam, substituem ou removem visitas devem atualizar esses totais ou reconstruí-los.

## Migrações

Migrações importantes ficam em `background.mirrors.js`:

- canonicalização de mirrors;
- normalização global de `www.`;
- aplicação atômica no fallback em memória.

Boas práticas:

- montar plano completo antes de escrever;
- aplicar IndexedDB em transação quando possível;
- no fallback `Map()`, aplicar primeiro em cópias e trocar o estado real apenas ao final;
- recalcular totais a partir do resultado final;
- preservar registros anonimizados antigos sem `host` legível quando não houver informação suficiente para recalcular identidade.

