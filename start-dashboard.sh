#!/bin/bash
# Start the workbot dashboard (server + client) inside the container
# Usage: place in /app and run, or source from entrypoint

cd /app

echo "[dashboard] Starting server on :3001..."
node node_modules/tsx/dist/cli.mjs watch server/src/index.ts &
SERVER_PID=$!

echo "[dashboard] Starting client on :5173 (host-accessible)..."
cd /app/client && node /app/node_modules/vite/bin/vite.js --host 0.0.0.0 &
CLIENT_PID=$!

cd /app

echo "[dashboard] Server PID=$SERVER_PID, Client PID=$CLIENT_PID"
echo "[dashboard] To stop: kill $SERVER_PID $CLIENT_PID"
