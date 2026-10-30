#!/usr/bin/env bash
# Radio X - configurar, iniciar e abrir no celular (QR code)
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

NAME=radiox
IMAGE=radiox
VOLUME=radiox-data
ENV_FILE=.env

say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m  %s\n' "$*" >&2; }
die()  { printf '\033[1;31mxx\033[0m  %s\n' "$*" >&2; exit 1; }
ask()  { local r; read -r -p "$1" r; echo "${r:-$2}"; }
yes_no() { local r; r=$(ask "$1" "$2"); [[ "$r" =~ ^[sSyY] ]]; }

need_podman() {
  command -v podman >/dev/null || die "Podman não encontrado. Instale: sudo apt install podman"
}

load_env() {
  MUSIC_PATH=""; PORT=8090
  # shellcheck disable=SC1090
  [ -f "$ENV_FILE" ] && . "$ENV_FILE"
  return 0
}

lan_ip() {
  local ip
  ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}') || true
  [ -n "${ip:-}" ] || ip=$(hostname -I 2>/dev/null | awk '{print $1}') || true
  echo "${ip:-127.0.0.1}"
}

count_audio() {
  find "$1" -type f \( -iname '*.mp3' -o -iname '*.flac' -o -iname '*.ogg' -o -iname '*.opus' -o -iname '*.m4a' -o -iname '*.wav' \) 2>/dev/null | wc -l
}

is_running() { [ "$(podman inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null || true)" = "true" ]; }

wait_ready() {
  for _ in $(seq 1 30); do
    (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null && return 0
    sleep 1
  done
  return 1
}

cmd_setup() {
  need_podman
  load_env
  say "Configuração do Radio X"
  local dflt="${MUSIC_PATH:-$HOME/Música}"
  local m
  while true; do
    m=$(ask "Pasta das músicas [$dflt]: " "$dflt")
    m="${m/#\~/$HOME}"
    [ -d "$m" ] && break
    warn "Pasta não encontrada: $m"
  done
  m=$(readlink -f "$m")
  local n
  n=$(count_audio "$m")
  say "Encontrei $n arquivos de áudio em $m"
  [ "$n" -gt 0 ] || warn "Nenhum áudio nessa pasta! Confira se é a pasta certa."

  local p
  while true; do
    p=$(ask "Porta [$PORT]: " "$PORT")
    [[ "$p" =~ ^[0-9]+$ ]] && [ "$p" -ge 1024 ] && [ "$p" -le 65535 ] && break
    warn "Use um número entre 1024 e 65535."
  done

  printf 'MUSIC_PATH="%s"\nPORT=%s\n' "$m" "$p" > "$ENV_FILE"
  say "Salvo em $ENV_FILE"
  MUSIC_PATH="$m"; PORT="$p"

  if command -v ufw >/dev/null && yes_no "Liberar a porta $PORT no firewall (ufw) para o celular? [S/n]: " "s"; then
    sudo ufw allow "$PORT/tcp" || warn "Não consegui liberar a porta (pode ser feito depois)."
  fi

  if yes_no "Iniciar agora? [S/n]: " "s"; then
    cmd_start
    yes_no "Definir o PIN das pastas privadas agora? [s/N]: " "n" && cmd_pin
  fi
}

cmd_build() {
  need_podman
  say "Construindo a imagem..."
  podman build -t "$IMAGE" .
}

cmd_start() {
  need_podman
  load_env
  [ -f "$ENV_FILE" ] || { warn "Primeiro uso: vou configurar."; cmd_setup; return; }
  [ -d "$MUSIC_PATH" ] || die "Pasta de músicas não existe: $MUSIC_PATH (rode ./radiox.sh setup)"
  if [ "$(count_audio "$MUSIC_PATH")" -eq 0 ]; then
    warn "A pasta $MUSIC_PATH não tem nenhum áudio (mp3, flac, ogg, opus, m4a, wav)."
    warn "A biblioteca vai subir vazia. Para trocar a pasta: ./radiox.sh setup"
    yes_no "Iniciar mesmo assim? [s/N]: " "n" || return 1
  fi
  podman image exists "$IMAGE" || cmd_build
  podman rm -f "$NAME" >/dev/null 2>&1 || true
  say "Iniciando o container..."
  podman run -d --name "$NAME" -p "$PORT:8000" \
    -v "$MUSIC_PATH:/musica:ro" -v "$VOLUME:/data" \
    -e AUTO_SCAN_SECONDS="${AUTO_SCAN_SECONDS:-60}" \
    --restart=unless-stopped "$IMAGE" >/dev/null
  wait_ready || { warn "Demorou para responder. Veja: ./radiox.sh logs"; return 1; }
  say "Radio X no ar!"
  cmd_qr
}

cmd_stop()    { need_podman; podman stop "$NAME" >/dev/null && say "Parado."; }
cmd_restart() { cmd_stop || true; cmd_start; }
cmd_update()  { cmd_build; cmd_start; }
cmd_logs()    { need_podman; podman logs -f --tail 50 "$NAME"; }

cmd_status() {
  need_podman; load_env
  if is_running; then
    say "Rodando em http://$(lan_ip):$PORT"
  else
    warn "Parado. Use: ./radiox.sh start"
  fi
}

cmd_qr() {
  need_podman; load_env
  is_running || die "O Radio X não está rodando. Use: ./radiox.sh start"
  local url="http://$(lan_ip):$PORT"
  echo
  podman exec "$NAME" python -c "import segno,sys; segno.make(sys.argv[1]).terminal(compact=True, border=2)" "$url" 2>/dev/null \
    || warn "Imagem antiga sem gerador de QR. Rode: ./radiox.sh update"
  echo
  say "Abra no celular (mesma rede Wi-Fi): $url"
}

cmd_pin() {
  need_podman
  is_running || die "O Radio X não está rodando."
  local a b
  read -r -s -p "Novo PIN: " a; echo
  read -r -s -p "Repita o PIN: " b; echo
  [ -n "$a" ] || die "PIN vazio."
  [ "$a" = "$b" ] || die "Os PINs não conferem."
  printf '%s\n' "$a" | podman exec -i "$NAME" sh -c 'cat > /data/pin.txt'
  say "PIN definido."
}

cmd_rescan() {
  need_podman
  is_running || die "O Radio X não está rodando."
  podman exec "$NAME" python -c "import urllib.request as u; u.urlopen(u.Request('http://127.0.0.1:8000/api/rescan', method='POST'))"
  say "Biblioteca atualizada."
}

cmd_autostart() {
  need_podman
  say "Ligando o início automático com o PC..."
  loginctl enable-linger "$USER"
  systemctl --user enable --now podman-restart.service
  say "Pronto: o Radio X volta sozinho quando o PC ligar."
}

cmd_help() {
  cat <<H
Radio X - uso: ./radiox.sh [comando]

  (sem comando)  configura na 1ª vez; depois inicia e mostra o QR
  setup          configura pasta de músicas e porta
  start          inicia e mostra o QR code
  stop           para
  restart        reinicia
  update         reconstrói a imagem (após mudar o código) e reinicia
  qr             mostra o QR code / endereço para o celular
  pin            define o PIN das pastas privadas
  rescan         atualiza a biblioteca (pastas novas)
  status         mostra se está rodando
  logs           acompanha os logs
  autostart      inicia junto com o PC
H
}

case "${1:-start}" in
  setup) cmd_setup ;;
  start|up) cmd_start ;;
  stop|down) cmd_stop ;;
  restart) cmd_restart ;;
  update|rebuild) cmd_update ;;
  qr) cmd_qr ;;
  pin) cmd_pin ;;
  rescan) cmd_rescan ;;
  status) cmd_status ;;
  logs) cmd_logs ;;
  autostart) cmd_autostart ;;
  help|-h|--help) cmd_help ;;
  *) cmd_help; exit 1 ;;
esac
