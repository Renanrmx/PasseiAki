# Backup, restauração, importação e exportação

Esta documentação cobre fluxos que movem dados para dentro ou fora da extensão.

## Backup completo

Implementado em `src/worker/background.backup.js`.

O payload contém:

- `version`
- `visits`
- `meta`
- `partialExceptions`
- `matchExceptions`
- `mirrorGroups`

Backups com senha usam envelope criptografado versão 1:

```json
{
  "v": 1,
  "salt": "...",
  "nonce": "...",
  "data": "..."
}
```

Backups sem senha usam envelope explícito, também versão 1:

```json
{
  "v": 1,
  "type": "passei-aki-backup",
  "encrypted": false,
  "createdAt": 1234567890,
  "payload": {}
}
```

O payload sem senha é legível intencionalmente.

## Criptografia de backup

Implementada em `src/worker/background.crypto.js`.

Componentes:

- Argon2id para derivação de chave;
- ChaCha20-Poly1305 para criptografia autenticada;
- salt de 16 bytes;
- nonce de 12 bytes.

O restore de backup criptografado exige senha correta. Backup sem senha é detectado automaticamente e não deve pedir senha.

## Validação antes de restaurar

Antes de restaurar, o payload passa por validação estrutural:

- `visits` e `meta` devem ser arrays;
- visitas precisam de campos essenciais;
- `queryParamsHash` deve ser array de strings;
- `meta.value` só aceita `string`, `number`, `boolean` ou `null`;
- `mirrorGroups` é normalizado/rejeitado via validação de mirrors.

Não processe payload bruto sem validação.

## Restore com merge

Quando restaurar com merge:

- registros legíveis existentes podem ser mesclados por ID;
- `visitCount` soma;
- `lastVisited` mantém o maior;
- `download` usa OR;
- preferências/configurações vêm do backup conforme fluxo atual.

Depois de escrever dados restaurados, a migração global de `www.` deve ser forçada para normalizar backups antigos.

## Importação de endereços

Implementada em `src/worker/background.import.js`.

Entrada esperada: texto com uma URL/endereço por linha.

Comportamento:

- linhas vazias são ignoradas;
- URL sem protocolo recebe `https://`;
- cada URL passa por `computeFingerprint`;
- duplicatas no mesmo plano são deduplicadas;
- importação real ignora registros que já existem no banco.

Importação não preserva datas externas por design. A data usada é a data da importação.

## Exportação

Implementada em `src/worker/background.export.js`.

Exporta apenas registros legíveis (`hashed === false`):

- CSV com endereço, último acesso, contagem e tipo;
- TXT com uma URL por linha.

Registros anonimizados não podem ser exportados como endereço legível.

