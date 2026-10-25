#!/bin/sh
# Raptoru 2.0 — Coolify's administration ports, closed from the Internet (docs/OPERATIONS.md « Administration de Coolify »).
#
# Coolify publishes through Docker 8000 (interface), 6001 (realtime) and 6002 (terminal). Docker-published ports go
# through the FORWARD chain: ufw does not filter them. Once the interface is served over HTTPS by Traefik (Coolify →
# Settings → Instance's Domain), they are closed on the public interface only, in DOCKER-USER (the one chain Docker never
# rewrites). The VPS itself keeps them (SSH tunnel to 127.0.0.1:8000); 22, 80 and 443 are never touched.
#
#   sudo sh coolify-admin-ports.sh --check   checks the HTTPS access, changes nothing
#   sudo sh coolify-admin-ports.sh --close   checks, then closes and keeps it closed after a reboot (systemd unit)
#   sudo sh coolify-admin-ports.sh --undo    reopens (removes the rules and the unit)
#   (--rules: used by the unit at boot — the rules only, no network check)
set -eu
PORTS="8000 6001 6002"
ADMIN_URL="${ADMIN_URL:-https://admin.raptoru.fr}"
UNIT=/etc/systemd/system/raptoru-coolify-admin-ports.service
SELF=/usr/local/sbin/raptoru-coolify-admin-ports

wan() { ip -o route get 1.1.1.1 | sed -n 's/.* dev \([^ ]*\).*/\1/p'; }
# $1 iptables|ip6tables, $2 -C|-I|-D, $3 interface, $4 port (the original port: DNAT already rewrote it)
rule() { "$1" "$2" DOCKER-USER -i "$3" -p tcp -m conntrack --ctorigdstport "$4" -j DROP 2>/dev/null; }
tables() { for t in iptables ip6tables; do "$t" -n -L DOCKER-USER >/dev/null 2>&1 && echo "$t"; done; }

apply() {
  WAN=$(wan)
  [ -n "$WAN" ] || { echo "public interface not found: nothing done"; exit 1; }
  [ -n "$(tables)" ] || { echo "DOCKER-USER chain not found (Docker not started?): nothing done"; exit 1; }
  for t in $(tables); do
    for p in $PORTS; do rule "$t" -C "$WAN" "$p" || rule "$t" -I "$WAN" "$p"; done
  done
  echo "closed from $WAN ($(tables | tr '\n' ' ')): $PORTS"
}

check() {
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$ADMIN_URL/login" || true)
  [ "$code" = 200 ] || {
    echo "REFUSED: $ADMIN_URL/login answers « $code » (200 over valid HTTPS expected) — nothing closed"
    exit 1
  }
  echo "HTTPS access OK: $ADMIN_URL"
}

case "${1:-}" in
  --check) check ;;
  --rules) apply ;;
  --close)
    check
    apply
    install -m 0755 "$0" "$SELF"
    cat >"$UNIT" <<EOF
[Unit]
Description=Raptoru — Coolify administration ports closed from the Internet
After=docker.service
Requires=docker.service
PartOf=docker.service

[Service]
Type=oneshot
ExecStart=$SELF --rules
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable raptoru-coolify-admin-ports.service
    echo "kept closed after a reboot (raptoru-coolify-admin-ports.service)"
    ;;
  --undo)
    WAN=$(wan)
    for t in $(tables); do
      for p in $PORTS; do while rule "$t" -D "$WAN" "$p"; do :; done; done
    done
    if command -v systemctl >/dev/null 2>&1; then
      systemctl disable raptoru-coolify-admin-ports.service 2>/dev/null || true
    fi
    rm -f "$UNIT" "$SELF"
    if command -v systemctl >/dev/null 2>&1; then systemctl daemon-reload; fi
    echo "reopened: $PORTS"
    ;;
  *)
    echo "usage: $0 --check | --close | --undo"
    exit 2
    ;;
esac
