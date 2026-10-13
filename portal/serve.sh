#!/bin/sh
# usage: ./serve.sh start | stop | status
cd "$(dirname "$0")" || exit 1
port="${PORT:-8913}"
running() { [ -f server.pid ] && kill -0 "$(cat server.pid)" 2>/dev/null; }

case "$1" in
  start)
    if running; then echo "already running: http://localhost:$port"; exit 0; fi
    nohup node server.mjs > server.log 2>&1 &
    echo $! > server.pid
    sleep 1
    if running; then echo "http://localhost:$port"; else cat server.log; rm -f server.pid; exit 1; fi ;;
  stop)
    if running; then kill "$(cat server.pid)"; rm -f server.pid; echo stopped; else echo "not running"; fi ;;
  status)
    if running; then echo "running (pid $(cat server.pid)): http://localhost:$port"; else echo "not running"; fi ;;
  *) echo "usage: $0 start|stop|status"; exit 1 ;;
esac
