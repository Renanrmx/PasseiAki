# Passei Aki

[Instale pelo Chrome Store](https://chromewebstore.google.com/detail/passei-aki/cjgkgmcaogogknnaflonleghgegpcjop)

[Instale pelo Mozilla Store](https://addons.mozilla.org/firefox/addon/passei-aki)

Extensão de navegador que sinaliza se um endereço já foi visitado e quando foi, é útil principalmente para quem faz muitas pesquisas e não quer se perder em tantos links.

Nas páginas os links que já foram acessados em algum momento são marcados com a cor verde.

O ícone da extensão muda para a cor verde indicando que já foi acessado em algum momento (é recomendado deixar a extensão sempre visível para facilitar ver essa mudança), ao clicar na extensão dá para ver quando foi o último acesso e quantas vezes foi acessado.

Em casos de endereços semelhantes mudando só alguns parâmetros o ícone muda para roxo e ao clicar na extensão são exibidos os últimos acessos a endereços que coincidam com alguns parâmetros quando comparados ao endereço da aba atual, esses parâmetros ficam em cores diferentes para facilitar a visualização e comparação.

O histórico fica em base local segura sem coleta de dados, o usuário pode escolher nas configurações se prefere deixar os endereços salvos em texto puro ou em hash, se escolher anonimizar deixa ainda mais seguro impedindo que alguém visualize os links, mas ainda mantém a funcionalidade principal de indicar quando um endereço já foi acessado.

## Recursos secundários
- Listagem dos últimos endereços acessados com data e hora (este recurso fica limitado se configurar a extensão para anonimizar os dados).
- Mirrors de sites: permite agrupar sites equivalentes para compartilharem o mesmo histórico de acessos.
- Exceções de match completo e parcial para ignorar sites específicos durante as comparações.
- Backup completo dos acessos e configurações, com opção de criar arquivo protegido por senha ou arquivo sem senha legível.
- Restauração de backup com opção de mesclar acessos ou substituir os dados atuais.
- Exportar endereços não anonimizados em formato de tabela (CSV) com datas de acesso ou em texto (TXT) apenas com os endereços.
- Importar endereços a partir de arquivo de texto, com uma URL por linha. Datas externas não são aceitas; os acessos importados recebem a data da importação para preservar a integridade do banco.
- Badge para downloads: pode indicar quando um link de download já foi acessado anteriormente.

## Persistência e privacidade
- Os registros são salvos apenas localmente, normalmente no IndexedDB.
- Se o navegador bloquear armazenamento persistente, a extensão usa armazenamento em memória com `Map()`. Nesse modo, a popup exibe um aviso porque os dados serão perdidos ao fechar a aplicação.
- As URLs são normalizadas e separadas em `host`, `path`, `query` e `fragment`. O prefixo inicial `www.` é ignorado globalmente.
- Quando a anonimização está habilitada nas configurações, as partes das URLs são salvas como HMAC-SHA512 com pepper local. Quando desabilitada, ficam legíveis para permitir histórico, busca, importação e exportação.
- Backup com senha: envelope `.bak` em JSON criptografado com Argon2id + ChaCha20-Poly1305. A senha é definida no momento do backup e exigida ao restaurar.
- Backup sem senha: envelope `.bak` em JSON legível, detectado automaticamente na restauração e validado antes de processar.

## Executar via código
1. Instale dependências: `npm install`.
2. Firefox (MV2 por padrão): `npm start` (clona `src` para `dist`, copia `manifest.firefox.json` para `dist/manifest.json` e roda `web-ext run` a partir de `dist`).
3. Chrome/Chromium ou Firefox MV3: gerar `dist` e usar `manifest.chrome.json` como `dist/manifest.json` (`npm run build:chrome` ou ajuste manual) e carregar em modo unpacked.

## Build
1. Instale dependências: `npm install`.
2. Crie o build para Firefox (`npm run build:firefox`) ou Chrome (`npm run build:chrome`). Os comandos de build executam `npm test` antes de gerar o pacote.

## Testes e lint

- `npm test`: executa a suíte com `node:test`.
- `npm run lint`: prepara o build Firefox, executa `web-ext lint` e valida referências do manifest Chrome.

## Documentação técnica

A documentação técnica para manutenção e evolução do projeto fica em `docs/`:

- [Arquitetura da extensão](docs/architecture.md)
- [Persistência, privacidade e modelo de dados](docs/persistence-and-data-model.md)
- [Matching, mirrors e normalização de domínios](docs/matching-and-mirrors.md)
- [Backup, restauração, importação e exportação](docs/backup-import-export.md)
- [Testes, lint e build](docs/testing-build.md)

Para mudanças simples de UI, comece por [Arquitetura da extensão](docs/architecture.md) e [Testes, lint e build](docs/testing-build.md).

Para mudanças que mexem com histórico, migrações, backup, mirrors ou anonimização, leia antes:

- [Persistência, privacidade e modelo de dados](docs/persistence-and-data-model.md)
- [Matching, mirrors e normalização de domínios](docs/matching-and-mirrors.md)
- [Backup, restauração, importação e exportação](docs/backup-import-export.md)

Essas áreas mexem diretamente com dados do usuário. A regra prática é planejar tudo antes de escrever, não misturar dados anonimizados e legíveis, e validar com `npm test`.

## Permissões
- storage: Utilizada para armazenamento local da extensão e preferências auxiliares.
- tabs: Utilizada para ler o URL da aba ativa e atualizar o ícone e o estado da extensão de acordo com a página visitada. Também é usada para ouvir eventos de abas (`onUpdated`, `onActivated`, `onRemoved`), mantendo o estado interno sincronizado com a navegação.
- activeTab: Concede acesso temporário à aba ativa após interação explícita do usuário, permitindo a leitura pontual do URL atual.
- webNavigation: Utilizada para observar navegação e redirecionamentos no frame principal, registrando corretamente URLs iniciais e finais.
- downloads: Utilizada para exportação manual de backups e arquivos `.csv`/`.txt`, e para detectar downloads criados pelo navegador para marcar/reconhecer links de download já acessados.
- Acesso a `http://*/*` e `https://*/*`: necessário para o content script analisar links em páginas visitadas e para o background comparar URLs acessadas.
