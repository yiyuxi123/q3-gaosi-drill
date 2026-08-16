#!/bin/zsh
cd "$(dirname "$0")"

if [ ! -x "./runtime/node" ]; then
  chmod +x "./runtime/node"
fi

"./runtime/node" server.cjs &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" >/dev/null 2>&1
}
trap cleanup EXIT INT TERM

sleep 2
open "http://127.0.0.1:5173/"
wait "$SERVER_PID"
