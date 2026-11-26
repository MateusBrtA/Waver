# PulseCord: servidor dedicado (Debian ou Windows)

O servidor dedicado roda o PulseCord 24 h por dia, sem precisar de alguém com o app aberto como Host.
Os amigos entram pelo app normal digitando o endereço do servidor.

- Escuta em **IPv6 e IPv4 ao mesmo tempo** (`::`, dual-stack). Se a máquina não tiver IPv6, usa só IPv4.
- A interface web vem junto: `http://endereço:3000` também abre o PulseCord no navegador.
- Dados (mensagens, arquivos, usuários) ficam numa pasta só: faça backup dela.

## Portas

| Para quê | Protocolo | Porta | Direção | Obrigatória |
|---|---|---|---|---|
| PulseCord (site, API, WebSocket) | TCP | 3000 (configurável) | entrada | sim |
| HTTPS com Caddy (opção `--https`) | TCP / UDP | 80, 443 | entrada | só com `--https` (aí a 3000 não precisa ficar aberta) |
| TURN (opção `--with-turn`) | TCP + UDP | 3478 | entrada | recomendado |
| Relay do TURN | UDP | 49160–49200 | entrada | com o TURN |
| YouTube/SoundCloud (yt-dlp), atualizações | TCP | 443 | **saída** | sim |
| STUN público (Google/Cloudflare) | UDP | 19302, 3478 | saída (nos clientes) | sem TURN próprio |

Libere as portas **em IPv4 e IPv6**: no firewall da máquina e, se houver, no painel do provedor ou no roteador.
Em IPv6 não existe "redirecionar porta" (NAT): basta a regra de entrada para o IPv6 do servidor.

As chamadas de voz e vídeo vão direto entre os participantes (WebRTC). O servidor só faz a sinalização.
O TURN entra quando duas pessoas não conseguem se ver diretamente (CGNAT, firewall de empresa, alguém só com IPv4 e outro só com IPv6).
Por isso ele é recomendado num servidor na internet.

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
   ```

O instalador faz o seguinte:
- **Node.js:** instala o Node ≥ 20. O Debian 13 já traz o 20; no Debian 12 ele usa o repositório oficial do NodeSource.
- **Usuário:** cria o usuário de sistema `pulsecord`.
- **Arquivos:** coloca o app em `/opt/pulsecord` e os dados em `/var/lib/pulsecord`.
- **Serviço:** cria o serviço `pulsecord` no systemd, que inicia com a máquina e reinicia se cair.
- **Firewall:** abre as portas no `ufw` (IPv4 + IPv6), se ele estiver ativo. Com nftables, veja `deploy/debian/nftables-pulsecord.nft`.
- **TURN (`--with-turn`):** instala o `coturn` e liga as credenciais temporárias. O app recebe o TURN sozinho, sem configurar nada nos clientes.
- **HTTPS (`--https`):** instala o Caddy com certificado Let's Encrypt.

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
Se o pacote trouxer o `PulseCord-Portable.exe` novo, os amigos recebem a atualização do app pelo próprio PulseCord.

### Backup
Pare o serviço, copie `/var/lib/pulsecord` e `/etc/pulsecord` e inicie de novo:
```
sudo systemctl stop pulsecord && sudo tar -czf pulsecord-backup.tar.gz /var/lib/pulsecord /etc/pulsecord && sudo systemctl start pulsecord
```

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

## Requisitos
- Debian 12 ou 13 (amd64 ou arm64). Com 1 vCPU e 1 GB de RAM roda bem para um grupo de amigos; o yt-dlp usa mais CPU por alguns segundos ao tocar uma música.
- Espaço: o cache de arquivos enviados fica limitado a 2 GB.
- **YouTube:** o yt-dlp é baixado sozinho (binário independente, sem Python) e usa o próprio Node do servidor como motor JavaScript, que o YouTube exige desde o fim de 2025.
  Se o YouTube bloquear o IP do servidor ("confirme que não é um robô"), cole um `cookies.txt` em Configurações do servidor → Integrações.
