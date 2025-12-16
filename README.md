# Passei Aki

Extensão de navegador que sinaliza se um endereço já foi visitado e quando foi, é útil principalmente para quem faz muitas pesquisas e não quer se perder em tantos links.

Nas páginas os links que já foram acessados em algum momento são marcados com a cor verde.

O ícone da extensão muda para a cor verde indicando que já foi acessado em algum momento (é recomendado deixar a extensão sempre visível para facilitar ver essa mudança), ao clicar na extensão dá para ver quando foi o último acesso e quantas vezes foi acessado.

Em casos de endereços semelhantes mudando só alguns parâmetros o ícone muda para roxo e ao clicar na extensão são exibidos os últimos acessos a endereços que coincidam com alguns parâmetros quando comparados ao endereço da aba atual, esses parâmetros ficam em cores diferentes para facilitar a visualização e comparação.

O histórico fica em base local segura sem coleta de dados, o usuário pode escolher nas configurações se prefere deixar os endereços salvos em texto puro ou em hash, se escolher anonimizar deixa ainda mais seguro impedindo que alguém visualize os links, mas ainda mantém a funcionalidade principal de indicar quando um endereço já foi acessado.

## Recursos secundários
- Listagem dos últimos endereços acessados com data e hora (este recurso fica limitado se configurar a extensão para anonimizar os dados).
- Backup seguro: em configurações pode criar ou restaurar um backup que é criptografado com uma senha definida no momento da criação.
- Exportar endereços acessados em formato de tabela com as datas de acesso.
- Importar endereços de arquivos de texto, cada linha contendo uma URL apenas, não são aceitas datas de acesso ficando assim com a data da importação, essa limitação é intencional para manter a integridade do banco sendo assim só podendo definir todos os campos por meio da restauração de backup que é criptografado.

## Persistência e privacidade
- Os registros são salvos após normalizados e separados em `host`, `path`, `params` e `fragment`, tudo é salvo apenas localmente no IndexedDB
- Quando a criptografia está habilitada nas configurações os dados das URLs são salvos como HMAC-SHA512 com pepper local, já quando desabilitada estes ficam legiveis.
- Backup/restore: envelope `.bak` (JSON) é criptografado com Argon2id + ChaCha20-Poly1305; A senha é definida pelo usuário no momento do backup e é requisitada ao restaurar em qualquer dispositivo.

## Executar via código
1. Instale dependências: `npm install`.
2. Firefox (MV2 por padrão): `npm start` (clona `src` para `dist`, copia `manifest.firefox.json` para `dist/manifest.json` e roda `web-ext run` a partir de `dist`).
3. Chrome/Chromium ou Firefox MV3: gerar `dist` e usar `manifest.chrome.json` como `dist/manifest.json` (`npm run build:chrome` ou ajuste manual) e carregar em modo unpacked.

## Build
1. Instale dependências: `npm install`.
2. Crie o build para Firefox (`npm run build:firefox`) ou Chrome (`npm run build:chrome`).
