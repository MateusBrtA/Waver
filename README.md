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
- **Voz e vídeo:** chamadas com supressão de ruído, volume por pessoa, câmera e **transmissão de tela até 4K e 120 fps** com o áudio do PC.
- **Chamadas grandes:** SFU opcional (mediasoup) que entra sozinho quando a chamada passa de algumas pessoas.
- **Juntos na chamada:** tocador de músicas e de vídeos sincronizado (YouTube, SoundCloud e outros), soundboard e whiteboard colaborativo (camadas, pincéis, animação).
- **Controle remoto:** quem transmite a tela pode liberar mouse, teclado e um controle de Xbox virtual para os outros.
- **Gravação com permissão:** gravar a chamada pede autorização de todos; quem entra numa chamada sendo gravada é avisado antes.
- **Status:** Disponível, Ausente (automático após 10 min parado), Ocupado (sem sons de mensagem) e Invisível.
- **Rede local sem servidor:** mensagens e chamadas diretas entre PCs da mesma rede.
- **Windows:** notificações nativas, atalhos globais, overlay em jogos, "Compartilhar no Waver" no Explorer e ícone na bandeja que mostra uma linha de som enquanto você fala.
- **Atualização automática e assinada** (veja [Atualizações](#atualizações)).

Os detalhes e as especificações de cada recurso estão em [Recursos em detalhe](#recursos-em-detalhe).

## Começando

### 1. Instalar o app (Windows 10/11, 64 bits)

Baixe na página de [Releases](https://github.com/MateusBrtA/Waver/releases/latest):

| Arquivo | Para quê |
|---|---|
| `Waver-Portable.exe` | Abre direto, sem instalar. |
| `Waver-Setup.exe` | Instalador, com atalho na Área de Trabalho e no Menu Iniciar (quando publicado na release). |

Começou pelo portátil e quer instalar? Em **Configurações → Configurações do Windows → Instalar no PC** o app baixa o instalador oficial, instala e abre já instalado, sem perder login nem configurações.

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

## Recursos em detalhe

### Servidor, canais e cargos

- **Canais:** texto, voz e **palco** (quem fala fica no palco, o resto na plateia; é possível levantar a mão), organizados em categorias que se arrastam para reordenar. Canais podem ser privados e duplicados com as permissões.
- **Cargos e permissões:** 27 permissões em grupos (servidor, moderação, texto, voz e apps, avançado), com ajuste por canal. Ninguém cria nem edita cargo acima do seu e ninguém liga uma permissão que não tem.
- **Moderação:** expulsar, banir (com motivo), silenciar ou ensurdecer alguém na chamada, mover entre canais e registro de auditoria de entradas, saídas, expulsões, banimentos e mudanças.
- **Entrada:** senha de convite opcional; contas sem senha recebem uma **chave de login** guardada no app de quem criou, então ninguém entra na sua conta só digitando o mesmo nick.
- **Eventos:** agenda com data futura e confirmação de presença.
- **Quadros Trello:** quadros de tarefas (até 15 por servidor, DM ou grupo).

### Chat

- Mensagens com respostas, **tópicos** (threads), reações com qualquer emoji (inclusive sequências como famílias e bandeiras) e mensagens fixadas.
- **Enquetes** com prazo e encerramento por quem criou.
- **Busca** sem diferenciar acentos, com filtros de autor (`from:`), conteúdo (`has:` link, imagem, arquivo, enquete) e datas; só mostra o que você tem permissão para ver.
- **Anexos:** até 6 arquivos por mensagem, 60 MB cada, com visualização de imagens, vídeos, áudio e **modelos 3D** (`.glb`, `.gltf`, `.fbx`, `.obj` e `.blend`, este convertido com o Blender do Host).
- **Transferência de arquivos grandes:** até cerca de 1,85 GB, com opção de **download único** (o arquivo some depois de baixado).
- **Prévia de links** do YouTube, Spotify, SoundCloud, TikTok, Instagram e Twitter/X.
- **Blocos de código** com detecção da linguagem.
- **GIFs** pelo KLIPY ou GIPHY (com a chave do dono do servidor) mais os GIFs enviados pelo próprio grupo, e favoritos.
- **Mensagens diretas e grupos** com ícone e nome próprios.
- **Mensagens novas:** uma bolinha branca à direita do canal e no canto do ícone do servidor (também dos outros servidores salvos) mostra onde chegou mensagem que você ainda não viu. Dentro do chat, se você subiu ou chegou mensagem lá embaixo, uma seta leva de volta ao fim.
- **Rolagem:** o chat abre sempre no fim (mesmo com o app abrindo minimizado ou imagens ainda carregando) e, ao trocar de conversa e voltar, continua onde você parou.
- **Mensagens salvas no PC:** as últimas 150 de cada canal ficam guardadas comprimidas e criptografadas (AES-256-GCM, chave protegida pelo Windows), separadas por servidor e conta. O canal abre na hora e o servidor atualiza em seguida. Sair da conta não apaga: ao entrar de novo, as conversas voltam.

### Voz e vídeo

- **Microfone:** detecção de voz ou **aperte para falar** (tecla configurável), supressão de ruído, cancelamento de eco e ganho automático. No perfil **Estúdio** tudo isso desliga para um som fiel.
- **Qualidade do áudio:** Opus a 128 kbps (160 kbps no perfil Estúdio); o áudio do PC na transmissão de tela vai a 192 kbps.
- **Volume por pessoa**, silenciar e ensurdecer, aviso quando você fala com o microfone desligado e indicador de quem está falando.
- **Câmera** e **transmissão de tela** de uma janela ou da tela inteira, com o áudio do PC:

  | Ajuste | Opções |
  |---|---|
  | Resolução | 720p, 1080p, 1440p ou a da fonte (até 4K) |
  | Quadros por segundo | 30, 60 ou 120 |
  | Taxa máxima | 6, 12, 22 ou 28 Mbps (ou automática) |
  | Codec | H.264 de preferência; modo de baixa latência para jogos |

- **Palco com várias telas:** assista a várias transmissões ao mesmo tempo, lado a lado e do mesmo tamanho, com os participantes embaixo. Arraste as divisórias para os lados, para cima e na diagonal (no cruzamento delas), e a borda de baixo para mudar a altura do palco. Arrastar até uma tela sumir foca a outra; clicar numa tela ou num participante foca nele, e clicar de novo volta à grade com os tamanhos que você deixou. O alfinete no canto fixa a tela em foco.
- **Foco em quem fala:** em foco, sem transmissão nem vídeo do YouTube, o palco mostra quem está falando (só entre quem está com câmera, se alguém estiver).
- **Parar de assistir:** sai de uma transmissão e fica só no áudio da chamada. O vídeo e o áudio da tela param de chegar para você, e quem transmite deixa de enviar para você.
- **Caminho da conexão:** as estatísticas mostram por onde a chamada passa (LAN, direto, VPN ou relay). Com Radmin/Hamachi o app prefere a conexão direta pela internet quando ela funciona, em vez do servidor da VPN.
- **PC fraco:** se o processador não dá conta da transmissão, ela cai sozinha para 30 fps e tenta voltar depois.
- **Chamadas grandes (SFU):** com o mediasoup ligado no servidor, a chamada passa a ser repassada por ele quando tem mais de 4 pessoas (ajustável), ou sempre, se o dono preferir. Assim cada um envia o próprio vídeo uma vez só.
- **Gravação:** a chamada (e a sua transmissão) vira um `.webm` (VP9/Opus) na pasta `Vídeos\Waver\Gravações`. Antes de gravar, **todos na chamada precisam permitir**; uma recusa ou 60 s sem resposta cancela. Todos veem "REC" ao lado do nome de quem grava. Vale também nas chamadas diretas da rede local.
- **Clipes:** guarda o último minuto da chamada para salvar com um atalho, em `Vídeos\Waver\Clipes`. Os outros veem que os clipes estão ligados.

### Juntos na chamada

- **Tocador de músicas** sincronizado: links do YouTube, Spotify e SoundCloud (faixas e playlists) e uma biblioteca do servidor com arquivos de até 80 MB. Fila, repetir, pular e voltar.
- **Tocador de vídeos** sincronizado: YouTube, Twitter/X, Instagram e TikTok, com fila e velocidade.
- **Soundboard:** sons de até 15 MB, tocados só na chamada em que você está e controlados por permissão.
- **Whiteboard colaborativo:**
  - Camadas, pranchetas e ferramentas de pincel, aerógrafo, preenchimento, degradê, retângulo, elipse, caminho vetorial, texto, seleção e mover camada.
  - 60 pincéis embutidos e importação de pincéis seus (`.png`, `.jpg`, `.webp`, `.gbr`, `.gih` e pacotes `.bundle`/`.zip` do Krita).
  - **Animação** quadro a quadro com papel vegetal (onion skin).
  - Exporta em PNG, SVG, PSD com camadas, GIF animado, vídeo WebM e PSD com um quadro por camada.
  - Cada sala tem o próprio quadro: quem não está na chamada não vê nem desenha.
- **Controle remoto:** quem transmite a tela pode liberar mouse, teclado e um controle de Xbox virtual (ViGEmBus) para outra pessoa, escolhendo o que vale. Os comandos vão por um canal direto (WebRTC) de baixa latência, e a permissão pode ser retirada a qualquer momento.

### Perfil e status

- Avatar, capa, fundo do perfil, cor de destaque, efeitos de perfil e temas do app.
- **Status:** Disponível, Ausente (automático depois de 10 minutos parado), Ocupado (sem sons de mensagem) e Invisível (os outros te veem offline). A atividade (o jogo aberto) aparece para os outros, menos no modo Invisível.

### Rede local sem servidor

- Os PCs da mesma rede se encontram sozinhos e trocam mensagens diretas, grupos, arquivos (até 64 MB) e chamadas, sem servidor.
- Cada PC tem uma chave própria (Ed25519) e assina o que envia: ninguém da rede se passa por outra pessoa nem entra numa chamada para a qual não foi chamado.
- As conversas guardadas no PC ficam criptografadas.

### Windows

- **Atalhos globais** (funcionam com o app em segundo plano): silenciar o microfone, desativar o áudio, mostrar o overlay e salvar clipe.
- **Overlay** por cima dos jogos, mostrando quem está na chamada e falando.
- Notificações nativas, menu **"Compartilhar no Waver"** no Explorer e opção de fechar para a bandeja.
- **Bandeja:** o ícone mostra uma linha de som animada enquanto você fala e fica vermelho com o microfone desligado.

### Servidor dedicado

- Roda em Linux (systemd) ou Windows (tarefa agendada), com **código do dono** gerado na instalação.
- HTTPS automático com Caddy e Let's Encrypt, TURN (coturn) para quem está atrás de NAT difícil e SFU opcional.
- Funciona em IPv4 e IPv6 e atrás de proxy reverso ou do túnel da Cloudflare.
- Cache de mídia com teto de 2 GB e limpeza pelos moderadores.
- **Atualização automática pelo GitHub:**
  - O servidor confere a cada 6 horas e baixa só o que mudou, com a mesma assinatura conferida pelos apps.
  - Se só a interface mudou, troca na hora, sem reiniciar.
  - Se o servidor mudou, espera não ter ninguém em chamada e reinicia em uns 2 segundos; os apps reconectam sozinhos.
  - Se a versão nova não subir, volta para a anterior.
  - Precisa de saída em IPv4, porque o GitHub não tem IPv6. Detalhes em [deploy/README-SERVIDOR.md](deploy/README-SERVIDOR.md).

## Atualizações

- O app procura uma versão nova no GitHub logo ao abrir e a cada hora, com uma consulta pequena.
- **Atualização leve:** baixa só os arquivos que mudaram, direto da versão mais nova (quem está várias versões atrás não passa por cada uma). Costuma ser de alguns KB a 2 MB. Se só a interface mudou, aplica recarregando a janela; senão, o app reabre em segundos, sem instalador. Quando a versão nova troca o Electron ou os programas auxiliares, vem o `.exe` completo.
- O download aparece num card com barra de progresso enquanto você usa o app: no máximo 6 MB/s, **pausando durante chamadas** e continuando de onde parou se a conexão cair. Ao baixar uma versão nova, as baixadas antes são apagadas.
- Pronto o download, aparece **"Aplicar agora"** (quando só a interface mudou) ou **"Reiniciar e atualizar"**. Nada é aplicado sem o seu clique.
- Todo `.exe` e todo pacote de atualização leve publicado tem uma **assinatura Ed25519** feita com a chave privada de quem publica, que não fica no GitHub. O app confere a assinatura, a versão e o SHA-256 antes de oferecer a atualização. Um arquivo trocado, alterado ou de versão mais velha é recusado, mesmo que venha do GitHub.
- Quem está na **4.4.1 ou 4.4.2** precisa atualizar à mão uma vez: nessas versões o botão "Reiniciar e atualizar" fecha o app sem instalar nada. Baixe o `.exe` da [última versão](https://github.com/MateusBrtA/Waver/releases/latest) e troque o antigo; a partir da 4.4.3 a atualização volta a ser automática.
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
