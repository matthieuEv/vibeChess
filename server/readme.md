# Server

Go 1.21+ WebSocket relay for online games. It relays moves only; clients must validate chess legality.

## Run
```bash
cd server
go run .
```

## Docker
```bash
cd server
docker compose up
```

The published `ghcr.io/matthieuev/vibechess-server:latest` image targets `linux/amd64` and `linux/arm64`.

To build locally instead:
```bash
docker compose up --build
```

## Environment
- `PORT` (default `8080`)
- `ALLOWED_ORIGINS` (comma-separated). Example:
  - `ALLOWED_ORIGINS="http://localhost:5173,http://127.0.0.1:5173"`
  - If unset, only `localhost` and `127.0.0.1` origins are allowed (any port).

## HTTP
- `GET /health` → `{"ok":true}`
- `GET /ws` → WebSocket upgrade

## WebSocket protocol
Messages are JSON: `{ "type": "...", "payload": { ... } }`

### Create game
```
client -> { "type":"create_game", "payload":{} }
server -> { "type":"game_created", "payload":{ "gameId":"AB12-CD34", "role":"white", "playerToken":"..." } }
```

### Join game
```
client -> { "type":"join_game", "payload":{ "gameId":"AB12-CD34" } }
server -> { "type":"game_joined", "payload":{ "gameId":"AB12-CD34", "role":"black", "playerToken":"..." } }
```

### Reconnect
```
client -> { "type":"reconnect", "payload":{ "gameId":"AB12-CD34", "playerToken":"..." } }
server -> { "type":"reconnected", "payload":{ "gameId":"AB12-CD34", "role":"white|black" } }
```

### Move relay
```
client -> { "type":"move", "payload":{ "gameId":"AB12-CD34", "playerToken":"...", "from":"e2", "to":"e4", "promotion":"q", "clientMoveId":"..." } }
server -> sender: { "type":"move_ack", "payload":{ "clientMoveId":"..." } }
server -> opponent: { "type":"opponent_move", "payload":{ "from":"e2","to":"e4","promotion":"q","clientMoveId":"..." } }
```

### State sync (optional)
```
client -> { "type":"state_sync", "payload":{ "gameId":"AB12-CD34", "playerToken":"...", "fen":"..." } }
server -> opponent: { "type":"state_sync", "payload":{ "fen":"..." } }
```

### Chat (optional)
```
client -> { "type":"chat", "payload":{ "gameId":"...", "playerToken":"...", "message":"..." } }
server -> opponent: { "type":"opponent_chat", "payload":{ "message":"..." } }
```

### Presence
```
server -> { "type":"opponent_joined", "payload":{} }
server -> { "type":"opponent_left", "payload":{} }
```

### Errors
```
server -> { "type":"error", "payload":{ "code":"...", "message":"..." } }
```

## Limits
- Max message size: 4 KB
- Rate limit: 30 messages / 10 seconds / connection → closed on excess
- In-memory only; empty games close immediately and inactive games are cleaned after 30 minutes
