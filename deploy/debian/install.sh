#!/usr/bin/env bash
# PulseCord - instalador do servidor dedicado para Debian 12/13 (IPv6 + IPv4).
#
# Uso (como root, dentro da pasta extraída do pacote pulsecord-server):
#   sudo ./deploy/debian/install.sh [--port 3000] [--with-turn] [--domain chat.exemplo.com] [--no-firewall]
#
#   --port N        porta TCP do PulseCord (padrão 3000)
#   --with-turn     instala o coturn (TURN) para chamadas atravessarem NAT/CGNAT e firewalls
#   --domain D      domínio apontado para este servidor (registros A/AAAA). Usado no TURN e no HTTPS opcional
#   --https         instala o Caddy como proxy HTTPS (exige --domain e as portas 80/443 livres)
#   --with-sfu      liga o SFU (mediasoup) para chamadas grandes: PULSECORD_SFU=auto e portas 40000-40999
#   --no-firewall   não mexe no firewall (ufw)
#
# Pode rodar de novo para atualizar: os dados em /var/lib/pulsecord são mantidos.
set -euo pipefail

PORT=3000
WITH_TURN=0
DOMAIN=""
WITH_HTTPS=0
WITH_SFU=0
FIREWALL=1
while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --with-turn) WITH_TURN=1; shift ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    --https) WITH_HTTPS=1; shift ;;
    --with-sfu) WITH_SFU=1; shift ;;
    --no-firewall) FIREWALL=0; shift ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "Opção desconhecida: $1"; exit 1 ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then
  echo "Rode como root: sudo $0 $*"
  exit 1
fi
if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  echo "Porta inválida: $PORT"
  exit 1
fi
if [ "$WITH_HTTPS" -eq 1 ] && [ -z "$DOMAIN" ]; then
  echo "--https precisa de --domain (um domínio com registros A/AAAA apontando para este servidor)."
  exit 1
fi

PKG_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
APP_DIR=/opt/pulsecord
DATA_DIR=/var/lib/pulsecord
ENV_DIR=/etc/pulsecord
ENV_FILE="$ENV_DIR/pulsecord.env"

if [ ! -f "$PKG_DIR/server/index.js" ] || [ ! -f "$PKG_DIR/client/dist/index.html" ]; then
  echo "Não achei server/index.js e client/dist/index.html em $PKG_DIR."
  echo "Rode este script de dentro do pacote pulsecord-server extraído."
  exit 1
fi

echo "==> Pacotes do sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg iproute2 rsync

node_major() { command -v node >/dev/null 2>&1 && node -p 'process.versions.node.split(".")[0]' || echo 0; }

echo "==> Node.js (precisa da versão 20 ou mais nova)"
if [ "$(node_major)" -lt 20 ]; then
  # Debian 13 (trixie) já traz o Node 20; o Debian 12 traz o 18, então usa o repositório oficial do NodeSource.
  CAND="$(apt-cache policy nodejs | awk '/Candidate:/ {print $2}' | cut -d. -f1 | sed 's/[^0-9].*//')"
  if [ -n "$CAND" ] && [ "$CAND" -ge 20 ] 2>/dev/null; then
    apt-get install -y nodejs npm
  else
    install -d -m 0755 /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
      > /etc/apt/sources.list.d/nodesource.list
    apt-get update -y
    apt-get install -y nodejs
  fi
fi
command -v npm >/dev/null 2>&1 || apt-get install -y npm
NODE_BIN="$(command -v node)"
echo "    Node $(node -v) em $NODE_BIN"

echo "==> Usuário de serviço e pastas"
id pulsecord >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin pulsecord
install -d -m 0755 "$APP_DIR" "$ENV_DIR"
install -d -m 0750 -o pulsecord -g pulsecord "$DATA_DIR"

echo "==> Copiando o PulseCord para $APP_DIR"
rsync -a --delete \
  --exclude 'server/node_modules' --exclude 'server/data' \
  "$PKG_DIR/server" "$PKG_DIR/client" "$PKG_DIR/package.json" "$PKG_DIR/deploy" "$APP_DIR/"
# exe do app para os amigos atualizarem pelo próprio PulseCord (opcional)
if [ -d "$PKG_DIR/dist-app" ]; then
  rsync -a "$PKG_DIR/dist-app" "$APP_DIR/"
else
  install -d -m 0755 "$APP_DIR/dist-app"
fi

echo "==> Dependências do servidor"
cd "$APP_DIR/server"
if [ -f package-lock.json ]; then
  npm ci --omit=dev --no-audit --no-fund
else
  npm install --omit=dev --no-audit --no-fund
fi
chown -R root:root "$APP_DIR"
# o mediasoup (SFU) é opcional: se o download do binário pronto falhar e não der para compilar, o npm
# segue sem ele e as chamadas ficam em malha. Avisa aqui para não ser surpresa.
if "$NODE_BIN" -e "import('mediasoup').then(()=>process.exit(0),()=>process.exit(1))" 2>/dev/null; then
  echo "    mediasoup (SFU) disponível"
else
  echo "    mediasoup (SFU) NÃO carregou: chamadas grandes ficam em malha P2P."
  echo "    Para compilar: apt-get install -y python3-pip build-essential && cd $APP_DIR/server && npm rebuild mediasoup"
fi

# Endereços públicos desta máquina
IPV6="$(ip -6 addr show scope global 2>/dev/null | awk '/inet6/ && !/temporary|deprecated/ {print $2}' | cut -d/ -f1 | grep -v '^f[cd]' | head -n1 || true)"
IPV4="$(ip -4 addr show scope global 2>/dev/null | awk '/inet / {print $2}' | cut -d/ -f1 | head -n1 || true)"

echo "==> Configuração ($ENV_FILE)"
if [ ! -f "$ENV_FILE" ]; then
  install -m 0640 -o root -g pulsecord "$APP_DIR/deploy/debian/pulsecord.env.example" "$ENV_FILE"
fi
set_env() { # set_env CHAVE valor
  if grep -q "^$1=" "$ENV_FILE"; then sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"; else echo "$1=$2" >> "$ENV_FILE"; fi
}
set_env PORT "$PORT"
set_env PULSECORD_HOST "::"

if [ "$WITH_TURN" -eq 1 ]; then
  echo "==> TURN (coturn)"
  apt-get install -y coturn
  TURN_SECRET="$(grep '^PULSECORD_TURN_SECRET=' "$ENV_FILE" | cut -d= -f2- || true)"
  if [ -z "$TURN_SECRET" ]; then TURN_SECRET="$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 40)"; fi
  REALM="${DOMAIN:-pulsecord}"
  sed -e "s|__SECRET__|$TURN_SECRET|" -e "s|__REALM__|$REALM|" \
    "$APP_DIR/deploy/debian/turnserver.conf.example" > /etc/turnserver.conf
  chmod 0640 /etc/turnserver.conf
  chown root:turnserver /etc/turnserver.conf 2>/dev/null || true
  # pacotes antigos do coturn só iniciam com isto ligado
  [ -f /etc/default/coturn ] && sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
  systemctl enable coturn >/dev/null 2>&1 || true
  systemctl restart coturn

  TURN_HOSTS=()
  if [ -n "$DOMAIN" ]; then TURN_HOSTS+=("$DOMAIN"); else
    [ -n "$IPV6" ] && TURN_HOSTS+=("[$IPV6]")
    [ -n "$IPV4" ] && TURN_HOSTS+=("$IPV4")
  fi
  TURN_URLS=""
  for h in "${TURN_HOSTS[@]}"; do
    TURN_URLS="${TURN_URLS:+$TURN_URLS,}turn:$h:3478?transport=udp,turn:$h:3478?transport=tcp"
  done
  set_env PULSECORD_TURN_SECRET "$TURN_SECRET"
  set_env PULSECORD_TURN_URLS "$TURN_URLS"
  STUN_URLS=""
  for h in "${TURN_HOSTS[@]}"; do STUN_URLS="${STUN_URLS:+$STUN_URLS,}stun:$h:3478"; done
  set_env PULSECORD_STUN_URLS "$STUN_URLS"
fi

SFU_MIN_PORT="$(grep '^PULSECORD_SFU_RTC_MIN_PORT=' "$ENV_FILE" | cut -d= -f2- || true)"
SFU_MAX_PORT="$(grep '^PULSECORD_SFU_RTC_MAX_PORT=' "$ENV_FILE" | cut -d= -f2- || true)"
SFU_MIN_PORT="${SFU_MIN_PORT:-40000}"
SFU_MAX_PORT="${SFU_MAX_PORT:-40999}"
if [ "$WITH_SFU" -eq 1 ]; then
  echo "==> SFU (mediasoup)"
  set_env PULSECORD_SFU "auto"
  [ -n "$IPV6" ] && set_env PULSECORD_SFU_ANNOUNCED_IPV6 "$IPV6"
  # IPv4 privado (atrás de NAT) só serve na rede local: troque pelo público em $ENV_FILE se for o caso
  [ -n "$IPV4" ] && set_env PULSECORD_SFU_ANNOUNCED_IPV4 "$IPV4"
fi
# já estava ligado de uma instalação anterior? então o firewall também precisa da faixa
SFU_ON=0
grep -Eq '^PULSECORD_SFU=(1|on|true|auto)' "$ENV_FILE" && SFU_ON=1

if [ "$WITH_HTTPS" -eq 1 ]; then
  echo "==> HTTPS (Caddy)"
  apt-get install -y caddy
  sed -e "s|__DOMAIN__|$DOMAIN|" -e "s|__PORT__|$PORT|" "$APP_DIR/deploy/debian/Caddyfile.example" > /etc/caddy/Caddyfile
  set_env PULSECORD_TRUST_PROXY "loopback"
  set_env PULSECORD_PUBLIC_URL "https://$DOMAIN"
  systemctl enable caddy >/dev/null 2>&1 || true
  systemctl restart caddy
fi

echo "==> Serviço systemd"
EXTRA_CAPS=""
if [ "$PORT" -lt 1024 ]; then EXTRA_CAPS="AmbientCapabilities=CAP_NET_BIND_SERVICE"; fi
sed -e "s|__NODE__|$NODE_BIN|" -e "s|__CAPS__|$EXTRA_CAPS|" \
  "$APP_DIR/deploy/debian/pulsecord.service" > /etc/systemd/system/pulsecord.service
systemctl daemon-reload
systemctl enable pulsecord >/dev/null
systemctl restart pulsecord

if [ "$FIREWALL" -eq 1 ]; then
  echo "==> Firewall"
  if command -v ufw >/dev/null 2>&1 && ufw status | grep -q 'Status: active'; then
    # o ufw aplica a mesma regra em IPv4 e IPv6 (IPV6=yes em /etc/default/ufw)
    grep -q '^IPV6=yes' /etc/default/ufw || echo "    ATENÇÃO: IPV6 não está 'yes' em /etc/default/ufw; o ufw não vai liberar IPv6."
    if [ "$WITH_HTTPS" -eq 1 ]; then ufw allow 80/tcp; ufw allow 443/tcp; ufw allow 443/udp; else ufw allow "$PORT"/tcp; fi
    if [ "$WITH_TURN" -eq 1 ]; then ufw allow 3478/tcp; ufw allow 3478/udp; ufw allow 49160:49200/udp; fi
    if [ "$SFU_ON" -eq 1 ]; then ufw allow "$SFU_MIN_PORT:$SFU_MAX_PORT/udp"; ufw allow "$SFU_MIN_PORT:$SFU_MAX_PORT/tcp"; fi
  else
    echo "    ufw não está ativo: nada foi alterado."
    echo "    Se você usa nftables, veja $APP_DIR/deploy/debian/nftables-pulsecord.nft"
    echo "    Se o provedor tem firewall próprio (painel da hospedagem), libere lá também (IPv4 e IPv6):"
    if [ "$WITH_HTTPS" -eq 1 ]; then echo "      TCP 80, TCP 443, UDP 443"; else echo "      TCP $PORT"; fi
    [ "$WITH_TURN" -eq 1 ] && echo "      TCP/UDP 3478 e UDP 49160-49200 (TURN)"
    [ "$SFU_ON" -eq 1 ] && echo "      UDP e TCP $SFU_MIN_PORT-$SFU_MAX_PORT (SFU)"
  fi
fi

echo "==> Aguardando o servidor subir"
for _ in $(seq 1 20); do
  [ -f "$DATA_DIR/owner-code.txt" ] && curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
  sleep 1
done

echo
echo "================================================================"
echo " PulseCord instalado e rodando (systemctl status pulsecord)"
echo "================================================================"
if [ "$WITH_HTTPS" -eq 1 ]; then
  echo " Endereço: https://$DOMAIN"
else
  [ -n "$IPV6" ] && echo " IPv6:  http://[$IPV6]:$PORT    (no app: [$IPV6]:$PORT)"
  [ -n "$IPV4" ] && echo " IPv4:  http://$IPV4:$PORT"
  [ -n "$DOMAIN" ] && echo " Domínio: http://$DOMAIN:$PORT"
fi
if [ -f "$DATA_DIR/owner-code.txt" ]; then
  echo " Código do dono: $(cat "$DATA_DIR/owner-code.txt")"
  echo "   (no app: 'Sou o dono deste servidor' na tela de entrar)"
fi
echo " Logs:   journalctl -u pulsecord -f"
echo " Config: $ENV_FILE   (depois de editar: systemctl restart pulsecord)"
echo " Dados:  $DATA_DIR   (faça backup desta pasta)"
echo "================================================================"
