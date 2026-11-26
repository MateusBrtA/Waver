# Waver: servidor dedicado (Debian ou Windows)

O servidor dedicado roda o Waver 24 h por dia, sem precisar de alguém com o app aberto como Host.
Os amigos entram pelo app normal digitando o endereço do servidor.

- Escuta em **IPv6 e IPv4 ao mesmo tempo** (`::`, dual-stack). Se a máquina não tiver IPv6, usa só IPv4.
- A interface web vem junto: `http://endereço:3000` também abre o Waver no navegador.
- Dados (mensagens, arquivos, usuários) ficam numa pasta só: faça backup dela.
- O Waver se chamava PulseCord. Os nomes técnicos continuam os antigos para não quebrar instalações existentes: serviço `pulsecord`, usuário `pulsecord`, pastas `/opt/pulsecord` e `/var/lib/pulsecord`, variáveis `PULSECORD_*`.

## Portas

| Para quê | Protocolo | Porta | Direção | Obrigatória |
|---|---|---|---|---|
| Waver (site, API, WebSocket) | TCP | 3000 (configurável) | entrada | sim |
| HTTPS com Caddy (opção `--https`) | TCP / UDP | 80, 443 | entrada | só com `--https` (aí a 3000 não precisa ficar aberta) |
| TURN (opção `--with-turn`) | TCP + UDP | 3478 | entrada | recomendado |
| Relay do TURN | UDP | 49160–49200 | entrada | com o TURN |
| Mídia do SFU (opção `--with-sfu`) | UDP (+ TCP) | 40000–40999 (configurável) | entrada | só com o SFU ligado |
| YouTube/SoundCloud (yt-dlp), atualizações | TCP | 443 | **saída** | sim |
| STUN público (Google/Cloudflare) | UDP | 19302, 3478 | saída (nos clientes) | sem TURN próprio |

Libere as portas **em IPv4 e IPv6**: no firewall da máquina e, se houver, no painel do provedor ou no roteador.
Em IPv6 não existe "redirecionar porta" (NAT): basta a regra de entrada para o IPv6 do servidor.

Sem o SFU, as chamadas de voz e vídeo vão direto entre os participantes (WebRTC, em malha). O servidor só faz a sinalização.
O TURN entra quando duas pessoas não conseguem se ver diretamente (CGNAT, firewall de empresa, alguém só com IPv4 e outro só com IPv6).
Por isso ele é recomendado num servidor na internet.
Com o SFU ligado, as chamadas grandes passam pelo servidor (veja [SFU](#sfu-chamadas-com-muita-gente)).

## Debian 12 / 13

1. No Windows, gere o pacote:
   ```
   npm run pack:server
   ```
   Isso cria `dist-server/pulsecord-server-<versão>.tar.gz`.
2. Copie o pacote para o servidor e extraia:
   ```
   scp dist-server/pulsecord-server-*.tar.gz usuario@[IPv6-do-servidor]:~
   ssh usuario@IPv6-do-servidor
   tar -xzf pulsecord-server-*.tar.gz && cd pulsecord-server-*
   ```
3. Instale (escolha as opções):
   ```
   sudo bash deploy/debian/install.sh --with-turn
   # com domínio (registros AAAA/A) e HTTPS automático:
   sudo bash deploy/debian/install.sh --with-turn --domain chat.exemplo.com --https
   # SFU para chamadas com muita gente (recomendado num servidor 24 h):
   sudo bash deploy/debian/install.sh --with-turn --with-sfu
   ```

O instalador faz o seguinte:
- **Node.js:** instala o Node ≥ 20. O Debian 13 já traz o 20; no Debian 12 ele usa o repositório oficial do NodeSource.
- **Usuário:** cria o usuário de sistema `pulsecord`.
- **Arquivos:** coloca o app em `/opt/pulsecord` e os dados em `/var/lib/pulsecord`.
- **Serviço:** cria o serviço `pulsecord` no systemd, que inicia com a máquina e reinicia se cair.
- **Firewall:** abre as portas no `ufw` (IPv4 + IPv6), se ele estiver ativo. Com nftables, veja `deploy/debian/nftables-pulsecord.nft`.
- **TURN (`--with-turn`):** instala o `coturn` e liga as credenciais temporárias. O app recebe o TURN sozinho, sem configurar nada nos clientes.
- **HTTPS (`--https`):** instala o Caddy com certificado Let's Encrypt.
- **SFU (`--with-sfu`):** liga `PULSECORD_SFU=auto`, anuncia os IPs da máquina e libera a faixa 40000–40999 no `ufw`.

No fim ele mostra os endereços e o **código do dono**.

### Entrar como dono
No app, na tela de entrar: digite o endereço, clique em **"Sou o dono deste servidor"** e cole o código.
Ele está em `/var/lib/pulsecord/owner-code.txt` e também aparece em `journalctl -u pulsecord`.
Quem entra com o código vira o Host e pode configurar canais, cargos, senha do servidor etc.

### Endereço para os amigos
- IPv6: `[2804:14c:abcd::10]:3000` (com colchetes; o app também aceita sem).
- Domínio: `chat.exemplo.com:3000`, ou `chat.exemplo.com` com `--https`.

**Atenção:** quem não tem IPv6 na internet de casa não alcança um servidor que só tem IPv6.
Para atender todo mundo:
- dê também um IPv4 ao servidor, ou
- use um domínio no Cloudflare com o proxy ligado (nuvem laranja). Ele recebe em IPv4 e IPv6 e repassa ao servidor em IPv6. Nesse caso use HTTPS na porta 443 (`--https`); o Cloudflare repassa WebSocket normalmente.

### Comandos úteis
```
systemctl status pulsecord        # está rodando?
journalctl -u pulsecord -f        # logs ao vivo
sudo systemctl restart pulsecord  # depois de mudar /etc/pulsecord/pulsecord.env
ss -ltnp | grep 3000              # deve mostrar [::]:3000 (IPv6 + IPv4)
curl -6 http://[::1]:3000/api/health
```

### Atualizar
Gere um pacote novo, extraia no servidor e rode o mesmo `install.sh` de novo.
Os dados e a configuração são mantidos.
Se o pacote trouxer o `Waver-Portable.exe` novo, os amigos recebem a atualização do app pelo próprio Waver.

### Backup
Pare o serviço, copie `/var/lib/pulsecord` e `/etc/pulsecord` e inicie de novo:
```
sudo systemctl stop pulsecord && sudo tar -czf pulsecord-backup.tar.gz /var/lib/pulsecord /etc/pulsecord && sudo systemctl start pulsecord
```

## SFU (chamadas com muita gente)

Na malha cada pessoa envia o seu áudio e vídeo **uma vez para cada outra pessoa**. Com 6 pessoas e câmera ligada, cada um sobe 5 cópias, e o upload de casa satura: o áudio picota e o vídeo trava.
Com o SFU (mediasoup) cada pessoa envia **uma vez só para o servidor**, e o servidor repassa para os outros.
A câmera vai em 3 qualidades (simulcast). O servidor manda para cada um a que cabe na rede dele, e com muitas câmeras na tela o app pede a menor.

Como funciona:
- **`PULSECORD_SFU=auto` (recomendado):** a call começa em malha. Quando passa de `PULSECORD_SFU_MIN_PEERS` pessoas (padrão 4, ou seja, a partir da 5ª), todos passam para o SFU sozinhos, sem sair da call. A call fica no SFU até esvaziar.
- **`PULSECORD_SFU=1`:** todas as calls passam pelo SFU.
- **`PULSECORD_SFU=0` ou vazio:** desligado (padrão).
- Se o mediasoup não estiver instalado, não compilar ou não conseguir abrir as portas, o servidor avisa no log e **todas as calls continuam em malha**, sem erro para os amigos. É o caso do Host dentro do app no Windows: lá o SFU nunca liga.
- Se entrar na call alguém com o app antigo (sem suporte a SFU), a call inteira volta para a malha.
- O controle remoto (Parsec) continua funcionando no SFU, só que passa pelo servidor em vez do canal P2P.

Para ligar no Debian:
1. Rode o instalador com `--with-sfu` (ou edite `/etc/pulsecord/pulsecord.env`, veja abaixo, e reinicie).
2. Libere a faixa de mídia **em IPv4 e IPv6**: UDP 40000–40999, e TCP na mesma faixa para quem está numa rede que bloqueia UDP. O `install.sh` faz isso no `ufw`. Com nftables, descomente as linhas do SFU em `deploy/debian/nftables-pulsecord.nft`. Se o provedor tiver painel de firewall, crie a regra lá também.
3. Confira os endereços anunciados: os clientes chegam ao SFU pelos IPs em `PULSECORD_SFU_ANNOUNCED_IPV6` e `PULSECORD_SFU_ANNOUNCED_IPV4`.
   - IPv6: o IPv6 global da máquina (o instalador detecta).
   - IPv4 atrás de NAT (internet de casa): ponha o IPv4 **público** e redirecione a faixa UDP 40000–40999 no roteador para a máquina. Sem isso, quem só tem IPv4 não alcança o SFU (o TURN do `--with-turn` ainda ajuda nesse caso).
4. Veja se ligou:
   ```
   journalctl -u pulsecord | grep SFU       # "[SFU] pronto: modo auto ..." mostra os candidatos (IP:porta)
   curl -s http://[::1]:3000/api/health      # campo "sfu": {"mode":"auto","available":true,...}
   ```
   Na call, o botão de status mostra **"Voz conectada (SFU)"** quando a mídia passa pelo servidor.

O mediasoup é instalado junto com as dependências do servidor.
O binário do worker (Linux x64 e arm64) já vem dentro do pacote do `npm run pack:server`, porque o GitHub, de onde o npm o baixaria, não tem IPv6: num servidor só com IPv6 o download falharia.
O `install.sh` usa esse binário (`MEDIASOUP_WORKER_BIN` no `pulsecord.env`) e avisa no fim se o SFU não carregou.
Para compilar na própria máquina: `apt-get install -y python3-pip build-essential && cd /opt/pulsecord/server && npm rebuild mediasoup` (precisa de internet com IPv4).

Consumo de banda do servidor: ele recebe uma cópia de cada fonte e envia N−1 cópias de cada uma.
- Voz: no máximo 0,13 Mbps por pessoa falando e por ouvinte.
- Câmera: quem liga envia as 3 camadas (~3,3 Mbps no total); cada ouvinte recebe uma só, de 0,15 a 2,5 Mbps.
- Exemplo: 6 pessoas com câmera, cada uma vendo as outras 5 na camada média (0,6 Mbps), dão uns 20 Mbps de entrada e uns 22 Mbps de saída no servidor.

## Windows (servidor sem abrir o app)
1. Instale o Node.js LTS: `winget install OpenJS.NodeJS.LTS`.
2. Extraia o `pulsecord-server-<versão>.zip`.
3. Dê dois cliques em `deploy\windows\Iniciar-Servidor.cmd`.

Opções, rodando o PowerShell **como administrador**:
```
deploy\windows\Iniciar-Servidor.ps1 -AbrirFirewall        # libera a porta no Firewall do Windows (IPv4 e IPv6)
deploy\windows\Iniciar-Servidor.ps1 -IniciarComWindows    # inicia sozinho junto com o Windows
deploy\windows\Iniciar-Servidor.ps1 -RemoverInicio        # desfaz o início automático
```
- **Configuração:** copie `deploy\debian\pulsecord.env.example` para `deploy\windows\pulsecord.env` e ajuste. As opções são as mesmas do Debian.
- **SFU:** funciona no Windows também (o mediasoup tem binário pronto). Ligue `PULSECORD_SFU=auto` no `pulsecord.env` e rode `-AbrirFirewall` de novo: ele libera a faixa do SFU.
- **Dados:** ficam na pasta `data` do pacote. O código do dono fica em `data\owner-code.txt`.

## Configuração (`/etc/pulsecord/pulsecord.env`)
| Variável | Para quê |
|---|---|
| `PORT` | porta TCP (padrão 3000) |
| `PULSECORD_HOST` | `::` (IPv6 + IPv4), `0.0.0.0` (só IPv4) ou um endereço específico |
| `PULSECORD_PUBLIC_URL` | endereço mostrado como principal |
| `PULSECORD_OWNER_CODE` | código do dono fixo (senão é gerado) |
| `PULSECORD_TRUST_PROXY` | `loopback` quando há proxy HTTPS na mesma máquina |
| `PULSECORD_TURN_URLS`, `PULSECORD_TURN_SECRET`, `PULSECORD_STUN_URLS` | TURN/STUN próprios (coturn) |
| `PULSECORD_LAN_DISCOVERY=1` | anuncia o servidor na rede local |
| `PULSECORD_SFU` | `auto` (SFU quando a call passa de N pessoas), `1` (sempre) ou `0` (desligado, padrão) |
| `PULSECORD_SFU_MIN_PEERS` | o N do modo `auto` (padrão 4: a 5ª pessoa liga o SFU) |
| `PULSECORD_SFU_ANNOUNCED_IPV4`, `PULSECORD_SFU_ANNOUNCED_IPV6` | IPs que os clientes usam para chegar ao SFU (detectados se vazios; `off` desliga uma das famílias) |
| `PULSECORD_SFU_RTC_MIN_PORT`, `PULSECORD_SFU_RTC_MAX_PORT` | faixa de portas da mídia (padrão 40000–40999) |
| `PULSECORD_SFU_TCP` | `0` desliga a mídia por TCP (padrão: UDP preferido, TCP de reserva) |
| `PULSECORD_SFU_WORKERS` | processos do mediasoup (padrão 1) |
| `PULSECORD_SFU_MAX_INCOMING_KBPS` | limite de envio de cada pessoa ao SFU (padrão 30000) |

## Requisitos
- Debian 12 ou 13 (amd64 ou arm64). Com 1 vCPU e 1 GB de RAM roda bem para um grupo de amigos; o yt-dlp usa mais CPU por alguns segundos ao tocar uma música.
- Espaço: o cache de arquivos enviados fica limitado a 2 GB.
- **YouTube:** o yt-dlp é baixado sozinho (binário independente, sem Python) e usa o próprio Node do servidor como motor JavaScript, que o YouTube exige desde o fim de 2025.
  Se o YouTube bloquear o IP do servidor ("confirme que não é um robô"), cole um `cookies.txt` em Configurações do servidor → Integrações.
