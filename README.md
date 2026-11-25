# 🎙️ PulseCord — App estilo Discord com Host Automático Embutido (1080p60 Grátis)

Aplicativo desktop estilo Discord feito sob medida para você e seus amigos: **visual fiel ao Discord**, **opção visível de Hospedar (automático) ou Entrar como Cliente dentro do próprio `.exe`**, servidor único privado, múltiplos chats e chamadas, imagens e GIFs, **transmissão de tela/vídeo em 1080p 60fps+ P2P grátis** com áudio do sistema, **Soundboard** e **Tocador de Músicas sincronizado**.

---

## 📦 Executáveis Prontos na Pasta

Você já tem os dois arquivos prontos para usar ou enviar direto aos seus amigos (na raiz da pasta e em `dist-app\`):

1. **`PulseCord-Setup.exe`** — Instalador do Windows (cria atalho na Área de Trabalho e Menu Iniciar, igual ao instalador do Discord).
2. **`PulseCord-Portable.exe`** — Executável portátil único (basta abrir sem instalar nada).

---

## 🚀 Como Usar (Sem Terminal, Tudo Dentro do App!)

### 1. Para Você (Hospedar o Servidor — 100% Grátis)
1. Abra **`PulseCord-Setup.exe`** (ou **`PulseCord-Portable.exe`**).
2. Na tela inicial, clique no botão **`Hospedar Servidor (Host)`**.
3. O app **inicia o servidor automaticamente** no seu PC em 1 segundo e mostra na tela:
   - Seu endereço do **Radmin VPN / Rede Local** (ex: `http://26.x.x.x:3000`) com botão **Copiar**.
   - Um botão **`Gerar Link Público Grátis`** (Túnel HTTPS Cloudflare) caso seus amigos não usem Radmin VPN!
4. Digite seu nome de usuário e clique em **Entrar no Meu Servidor**.
5. Mesmo já dentro do servidor, o botão **`HOST`** fica sempre visível na barra lateral esquerda e no topo da lista de canais para você copiar o endereço, ligar/desligar o link público ou alternar para **Cliente** quando quiser!

### 2. Para seus Amigos (Clientes)
1. Envie o **`PulseCord-Setup.exe`** (ou **`PulseCord-Portable.exe`**) para eles.
2. Eles abrem o app, deixam selecionado **`Entrar como Cliente`**, colam o endereço que você mandou (IP do Radmin ou link `https://...trycloudflare.com`), colocam o nome de usuário e clicam em **Conectar ao Servidor**!
   *(Dica: eles também podem abrir o link direto no Chrome/Edge e baixar o `.exe` pelo botão de download do app!)*

---

## ✨ Recursos Incluídos

- **Visual estilo Discord**: Barra lateral de servidor à esquerda (`#1e1f22`), lista de canais recolhível (`#2b2d31`), área de chat (`#313338`), barra de voz conectada com sinal verde e barra inferior de usuário com microfone, fone e engrenagem.
- **Servidor Único + Múltiplos Chats e Chamadas**: Crie quantos chats de texto (`#`) e salas de voz/vídeo (`🔊`) quiser.
- **Transmissão de Tela e Câmera 1080p 60fps+ (P2P Grátis)**:
  - Seleção visual de tela ou janela/jogo no Windows + **áudio do sistema/jogo nativo (WASAPI Loopback)**.
  - Qualidade configurável: **720p / 1080p / 1440p / Fonte (4K)**, **30 ou 60 FPS**, **Bitrate até 20 Mbps**.
  - **Telemetria ao vivo** sobre o vídeo (`1920×1080 • 60 FPS • Mbps • Codec • Ping`).
  - Volume individual por amigo (0% a 200%) e voz contínua enquanto navega pelo chat.
- **Imagens e GIFs no Chat**: Upload, arrastar e soltar, **Ctrl+V** de prints/GIFs, lightbox em tela cheia, Galeria compartilhada de GIFs do servidor + busca online opcional (Tenor/Giphy).
- **Soundboard + Tocador de Músicas na Call**: 8 efeitos sonoros prontos + upload de MP3/WAV/OGG personalizados + fila sincronizada de músicas (upload de áudio ou link direto) com volume independente para cada pessoa.

---

## 🛠️ Comandos de Desenvolvimento (Opcional)

- Compilar frontend + ícones: `npm run build`
- Gerar instalador + portátil: `npm run build:win` (ou dê duplo clique em `Gerar-App-Para-Amigos.bat`)
- Modo desenvolvimento Desktop: `npm run dev:electron`
