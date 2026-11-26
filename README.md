<p align="center">
  <img src="brand/waver-mascot.svg" width="140" alt="Wavy, o mascote do Waver">
</p>

<h1 align="center">Waver</h1>

<p align="center">
  Chat de texto, voz, vídeo e tela para grupos de amigos, num servidor que é <b>seu</b>.<br>
  Hospede no próprio PC com um clique ou deixe rodando 24 h num servidor Linux ou Windows.
</p>

<p align="center">
  <a href="https://github.com/MateusBrtA/Waver/releases/latest"><b>⬇ Baixar a última versão</b></a>
</p>

---

## O que é

O Waver é um app de comunicação para grupos pequenos (amigos, time, guilda) que não querem depender de uma plataforma de terceiros.
Uma pessoa hospeda o servidor e as outras entram pelo app.
Mensagens, arquivos e contas ficam no servidor de quem hospeda, não numa empresa.

As chamadas de voz e vídeo vão direto entre os participantes (WebRTC). Em chamadas grandes o servidor pode repassar a mídia (SFU), para não sobrecarregar a internet de ninguém.

> O Waver se chamava **PulseCord**. Quem já usava não perde nada ao atualizar: login, configurações e servidores salvos continuam.

## Recursos

- **Chat:** canais de texto, mensagens diretas e grupos, respostas, reações, enquetes, tópicos, busca, fixar mensagens, anexos, GIFs (KLIPY ou GIPHY) e seletor completo de emojis.
- **Voz e vídeo:** chamadas com supressão de ruído, volume por pessoa, câmera e **transmissão de tela até 1080p 60 fps** com o áudio do PC.
- **Chamadas grandes:** SFU opcional (mediasoup) que entra sozinho quando a chamada passa de algumas pessoas.
- **Juntos na chamada:** tocador de músicas e de vídeos sincronizado (YouTube, SoundCloud e outros), soundboard e whiteboard colaborativo (camadas, pincéis, animação).
- **Controle remoto:** quem transmite a tela pode liberar mouse, teclado e um controle de Xbox virtual para os outros.
- **Gravação com permissão:** gravar a chamada pede autorização de todos; quem entra numa chamada sendo gravada é avisado antes.
- **Status:** Disponível, Ausente (automático após 10 min parado), Ocupado (sem sons de mensagem) e Invisível.
- **Rede local sem servidor:** mensagens e chamadas diretas entre PCs da mesma rede.
- **Windows:** notificações nativas, atalhos globais, overlay em jogos, "Compartilhar no Waver" no Explorer e ícone na bandeja que mostra uma linha de som enquanto você fala.
- **Atualização automática e assinada** (veja [Atualizações](#atualizações)).

## Começando

### 1. Instalar o app (Windows 10/11, 64 bits)

Baixe na página de [Releases](https://github.com/MateusBrtA/Waver/releases/latest):

| Arquivo | Para quê |
|---|---|
| `Waver-Portable.exe` | Abre direto, sem instalar. |
| `Waver-Setup.exe` | Instalador, com atalho na Área de Trabalho e no Menu Iniciar (quando publicado na release). |

O `.exe` ainda não tem certificado de assinatura de código do Windows.
Na primeira vez o SmartScreen pode mostrar "O Windows protegeu o computador": clique em **Mais informações → Executar assim mesmo**.

### 2. Criar um servidor ou entrar num

- **Hospedar no seu PC:** na tela inicial escolha **Hospedar servidor**. O servidor sobe dentro do app (porta 3000) e mostra o endereço para mandar aos amigos. Ele fica no ar enquanto o app estiver aberto.
- **Entrar:** escolha **Entrar como cliente**, cole o endereço que receberam e escolha um nome.
- **Pelo navegador:** o endereço do servidor também abre o Waver no Chrome/Edge (o microfone exige HTTPS fora da rede local).

### 3. Deixar os amigos alcançarem o servidor

Escolha **uma** destas formas:

| Forma | Precisa | Bom para |
|---|---|---|
| Mesma rede / VPN (Radmin VPN, ZeroTier, Tailscale) | Todos na mesma rede ou VPN | Jogatina com amigos, sem mexer no roteador |
| Link público grátis (Cloudflare Tunnel) | Botão **Gerar link público** no app do Host | Testar rápido, sem abrir porta |
| Abrir a porta no roteador | Redirecionar **TCP 3000** para o PC do Host e liberar no Firewall do Windows | Servidor caseiro fixo |
| Servidor dedicado (Linux ou Windows) | Uma máquina ligada 24 h (VPS ou PC) | Grupo que usa todo dia |

## Servidor dedicado

O servidor dedicado roda o Waver sem ninguém com o app aberto.
O pacote `pulsecord-server-<versão>` (`.tar.gz` para Linux, `.zip` para Windows) fica nas [releases](https://github.com/MateusBrtA/Waver/releases); se a mais nova não tiver, gere com `npm run pack:server`.
O guia completo, com HTTPS, TURN, SFU, IPv6 e backup, está em [deploy/README-SERVIDOR.md](deploy/README-SERVIDOR.md).

### Linux (Debian 12/13)

```bash
# baixe o pacote .tar.gz da release mais nova e extraia
tar -xzf pulsecord-server-*.tar.gz && cd pulsecord-server-*
# instala Node, cria o serviço systemd e abre o firewall (ufw)
sudo bash deploy/debian/install.sh --with-turn
# com domínio e HTTPS automático (Let's Encrypt):
sudo bash deploy/debian/install.sh --with-turn --domain chat.exemplo.com --https
```

No fim o instalador mostra o endereço e o **código do dono**.
No app, na tela de entrar, use **"Sou o dono deste servidor"** com esse código para virar administrador.

```bash
systemctl status pulsecord     # está rodando?
journalctl -u pulsecord -f     # logs ao vivo
```

### Windows

1. Instale o Node.js LTS: `winget install OpenJS.NodeJS.LTS`.
2. Extraia o `pulsecord-server-<versão>.zip`.
3. Dê dois cliques em `deploy\windows\Iniciar-Servidor.cmd`.
4. Para liberar o firewall e iniciar junto com o Windows, no PowerShell **como administrador**:
   ```powershell
   deploy\windows\Iniciar-Servidor.ps1 -AbrirFirewall -IniciarComWindows
   ```

### O que precisa ficar aberto

| Para quê | Protocolo | Porta | Obrigatória |
|---|---|---|---|
| Waver (site, API, WebSocket) | TCP | 3000 (configurável) | sim |
| HTTPS com Caddy (`--https`) | TCP/UDP | 80, 443 | só com HTTPS (aí a 3000 pode ficar fechada) |
| TURN (`--with-turn`) | TCP + UDP | 3478 | recomendado na internet |
| Relay do TURN | UDP | 49160–49200 | com o TURN |
| Mídia do SFU (`--with-sfu`) | UDP (+ TCP) | 40000–40999 | só com o SFU |

- Libere as portas no firewall da máquina **e**, se houver, no painel do provedor (VPS) ou no roteador (redirecionamento de porta para o IP do servidor).
- Em IPv6 não há redirecionamento: basta a regra de entrada.
- Requisitos: 1 vCPU e 1 GB de RAM atendem um grupo de amigos. Sem o SFU, o servidor só faz a sinalização e quase não usa banda nas chamadas.

## Atualizações

- O app procura uma versão nova no GitHub ao abrir e a cada 4 horas, com uma consulta pequena.
- Se houver, baixa em segundo plano: no máximo 3 MB/s, **pausando durante chamadas** e continuando de onde parou se a conexão cair.
- Pronto o download, aparece **"Reiniciar e atualizar"**. A instalação só acontece quando você clica.
- Todo `.exe` publicado tem uma **assinatura Ed25519** feita com a chave privada de quem publica, que não fica no GitHub. O app confere a assinatura, a versão e o SHA-256 antes de oferecer a atualização. Um arquivo trocado, alterado ou de versão mais velha é recusado, mesmo que venha do GitHub.
- Servidores Waver também podem oferecer a atualização aos amigos pela rede local, com as mesmas verificações.

## Segurança e privacidade

- Senhas guardadas com bcrypt; servidor com senha de convite opcional, cargos, permissões e banimento.
- O código do dono é gerado na instalação. Entrar como dono sem ele só funciona no próprio PC do Host, nunca através de túnel ou proxy.
- Limite de tentativas de login, validação de uploads e salas do whiteboard isoladas.
- A janela do app não navega para sites externos: links abrem no navegador.
- Encontrou uma falha? Abra uma *issue* sem detalhes sensíveis pedindo um contato privado, ou use **Security → Report a vulnerability** no GitHub.

## Desenvolvimento

Requisitos: Windows 10/11, Node.js 20 ou mais novo e o .NET Framework 4 (já vem no Windows; usado para compilar dois auxiliares pequenos).

```bash
npm run setup          # instala as dependências (raiz, server e client)
npm run dev            # servidor (3000) + interface (5173) no navegador
npm run dev:electron   # app desktop em modo desenvolvimento
npm run build:exe      # gera dist-app/Waver-Portable.exe (e deixa a cópia na raiz)
npm run build:win      # portátil + instalador
npm run pack:server    # pacote do servidor dedicado (dist-server/)
npm run build:icon     # gera os ícones a partir de brand/*.svg
```

### Publicar uma versão (mantenedor)

1. Suba a versão em `package.json` (os apps só atualizam para uma versão **maior**).
2. `npm run build:win` (portátil + instalador) e `npm run pack:server` (servidor dedicado). O `.exe` é assinado com a chave em `%USERPROFILE%\.pulsecord-release\` (crie uma vez com `npm run release:key` e guarde um backup fora do PC).
3. Faça commit e `git push`.
4. `npm run release:github -- --dry-run` para conferir; depois `npm run release:github` para publicar. O script recusa versão repetida ou mais velha e arquivo que não confere com a assinatura.

### Estrutura

| Pasta | Conteúdo |
|---|---|
| `client/` | Interface (React + TypeScript + Vite + Tailwind) |
| `electron/` | App desktop: janela, bandeja, host embutido, atualização, integrações do Windows |
| `server/` | Servidor (Express + Socket.IO), SFU opcional (mediasoup) |
| `deploy/` | Instalação do servidor dedicado (Debian e Windows) |
| `brand/` | Logo e mascote (SVG) |
| `scripts/` | Build, assinatura, ícones e publicação |

## Créditos

- Pincéis embutidos do whiteboard: conjuntos em domínio público (CC0).
- [mediasoup](https://mediasoup.org) (SFU), [Socket.IO](https://socket.io), [yt-dlp](https://github.com/yt-dlp/yt-dlp), [ViGEm](https://github.com/nefarius/ViGEmBus) (controle virtual), GIFs por [KLIPY](https://klipy.com) ou GIPHY.

## Licença

[MIT](LICENSE): pode usar, modificar e redistribuir, mantendo o aviso de copyright.

O Waver é um projeto independente, inspirado em apps de chat por voz como o Discord, e **não tem relação** com a Discord Inc.
