#!/bin/sh
# Raptoru 2.0 - Coolify's administration ports, closed from the Internet (docs/OPERATIONS.md "Administration de Coolify").
#
# Coolify publishes through Docker 8000 (interface), 6001 (realtime) and 6002 (terminal). Docker-published ports go
# through the FORWARD chain: ufw does not filter them. The dashboard is served over HTTPS by Traefik
# (https://dashboard.raptoru.fr, realtime and terminal included), so these ports are closed on the public interface only.
# The VPS itself keeps them (SSH tunnel to 127.0.0.1:8000); 22, 80, 443 and ufw are never touched.
#
# Rules live in their own chain, RAPTORU-ADMIN (IPv4 and IPv6), jumped to from DOCKER-USER (published ports, the one
# chain Docker never rewrites) and INPUT (docker-proxy answers IPv6 itself when a network is IPv4-only).
#
#   sh coolify-admin-ports.sh --check   checks the HTTPS dashboard, changes nothing
#   sh coolify-admin-ports.sh --close   checks, then closes and keeps it closed after a reboot (systemd unit)
#   sh coolify-admin-ports.sh --undo    reopens (removes the rules and the unit)
#   (--rules: used by the unit at boot - the rules only, no network check)
# Emergency reopen by hand (VNC console): iptables -F RAPTORU-ADMIN; ip6tables -F RAPTORU-ADMIN
set -eu
PORTS="8000 6001 6002"
ADMIN_URL="${ADMIN_URL:-https://dashboard.raptoru.fr}"
CHAIN=RAPTORU-ADMIN
UNIT=/etc/systemd/system/raptoru-coolify-admin-ports.service
SELF=/usr/local/sbin/raptoru-coolify-admin-ports

wan() { ip -o route get 1.1.1.1 | sed -n 's/.* dev \([^ ]*\).*/\1/p'; }
has() { "$1" -n -L "$2" >/dev/null 2>&1; }
# $1 iptables|ip6tables, $2 INPUT|DOCKER-USER: one jump to $CHAIN, at the top
jump() { "$1" -C "$2" -j "$CHAIN" 2>/dev/null || "$1" -I "$2" -j "$CHAIN"; }

apply() {
  WAN=$(wan)
  [ -n "$WAN" ] || { echo "public interface not found: nothing done"; exit 1; }
  has iptables DOCKER-USER || { echo "DOCKER-USER chain not found (Docker not started?): nothing done"; exit 1; }
  for t in iptables ip6tables; do
    has "$t" INPUT || continue
    "$t" -N "$CHAIN" 2>/dev/null || "$t" -F "$CHAIN"
    # connections opened from the Internet only (--ctdir ORIGINAL: replies to the VPS's own outgoing connections pass),
    # by their original port (Docker's DNAT already rewrote the destination)
    for p in $PORTS; do
      "$t" -A "$CHAIN" -i "$WAN" -p tcp -m conntrack --ctdir ORIGINAL --ctorigdstport "$p" -j DROP
    done
    jump "$t" INPUT
    if has "$t" DOCKER-USER; then jump "$t" DOCKER-USER; fi
    echo "$t: $PORTS closed from $WAN"
  done
}

undo() {
  for t in iptables ip6tables; do
    for c in INPUT DOCKER-USER; do while "$t" -D "$c" -j "$CHAIN" 2>/dev/null; do :; done; done
    "$t" -F "$CHAIN" 2>/dev/null || true
    "$t" -X "$CHAIN" 2>/dev/null || true
  done
}

check() {
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$ADMIN_URL/login" || true)
  [ "$code" = 200 ] || {
    echo "REFUSED: $ADMIN_URL/login answers '$code' (200 over valid HTTPS expected) - nothing closed"
    exit 1
  }
  echo "HTTPS dashboard OK: $ADMIN_URL"
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
Description=Raptoru - Coolify administration ports closed from the Internet
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
    undo
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
