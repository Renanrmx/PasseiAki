# Matching, mirrors e normalização de domínios

Esta área define quando uma URL nova deve ser considerada já visitada, parcialmente semelhante ou pertencente a um grupo de aliases.

## Normalização central

Helpers de domínio ficam em `src/shared/domains.js`.

Regras atuais:

- remover protocolo, path, query, fragment e porta para entradas manuais de domínio;
- converter host para minúsculas;
- remover apenas o prefixo inicial exato `www.`;
- manter subdomínios distintos: `site.com`, `app.site.com` e `blog.site.com` são diferentes;
- mirrors não diferenciam HTTP e HTTPS.

Arquivos que dependem dessas regras:

- `src/worker/background.utils.js`
- `src/worker/background.match.js`
- `src/worker/background.mirrors.js`
- `src/panel/domain-tags.js`

## Fingerprint

`computeFingerprint` fica em `src/worker/background.match.js`.

Ele:

1. normaliza a URL;
2. resolve mirror/canônico, se existir;
3. monta chaves legíveis e hasheadas;
4. cria IDs candidatos para canônico e aliases;
5. retorna dados suficientes para match completo, parcial e gravação.

O ID tem a forma:

```text
hostKey|pathKey|queryKey|fragmentKey
```

No modo legível, `hostKey/pathKey/queryKey/fragmentKey` são legíveis. No modo anonimizado, são hashes.

## Match completo

O match completo procura IDs candidatos no banco. A busca considera:

- ID principal;
- ID hash;
- ID legível;
- IDs candidatos de aliases;
- representação alternativa quando necessário.

Exceções de match completo podem bloquear essa etapa.

## Match parcial

O match parcial compara registros do mesmo host/path e considera diferença de fragmento ou interseção parcial de parâmetros.

A lista exibida na popup principal é limitada pelo background, atualmente com limite 5 em `GET_PARTIAL_MATCHES`.

Exceções de match parcial bloqueiam essa busca.

## Mirrors de sites

Mirrors ficam em `src/worker/background.mirrors.js`.

Um grupo tem:

- `canonical`: primeiro site cadastrado;
- `aliases`: demais sites do grupo.

Exemplo:

```json
{
  "canonical": "site-a.com",
  "aliases": ["site-b.com"]
}
```

Com canônico puro, acesso a `site-b.com/p` é salvo como `site-a.com/p`.

## Busca por aliases

O histórico exibe o canônico, mas a busca textual amplia a superfície pesquisável:

- registro salvo como `site-a.com/produto`;
- grupo inclui `site-b.com`;
- busca por `e-b.com/pro` encontra o registro canônico.

Isso é implementado criando endereços virtuais por alias para registros legíveis.

## Exceções e mirrors

Ao checar exceções, o domínio é normalizado e, quando aplicável, expandido para hosts do grupo de mirrors.

Isso permite que uma exceção cadastrada para alias não canônico funcione para o canônico e demais aliases, sem transformar subdomínios diferentes em equivalentes.

