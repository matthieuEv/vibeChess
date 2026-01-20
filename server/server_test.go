package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

type wsMessage struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

type gameCreatedPayload struct {
	GameID      string `json:"gameId"`
	Role        string `json:"role"`
	PlayerToken string `json:"playerToken"`
}

type gameJoinedPayload struct {
	GameID      string `json:"gameId"`
	Role        string `json:"role"`
	PlayerToken string `json:"playerToken"`
}

type moveAckPayload struct {
	ClientMoveID string `json:"clientMoveId"`
}

type opponentMovePayload struct {
	From         string `json:"from"`
	To           string `json:"to"`
	Promotion    string `json:"promotion"`
	ClientMoveID string `json:"clientMoveId"`
}

type opponentChatPayload struct {
	Message string `json:"message"`
}

type stateSyncServerPayload struct {
	Fen string `json:"fen"`
}

type gameClients struct {
	server     *server
	testServer *httptest.Server
	wsURL      string
	white      *websocket.Conn
	black      *websocket.Conn
	gameID     string
	whiteToken string
	blackToken string
}

func newWSServer(t *testing.T) *gameClients {
	t.Helper()
	t.Setenv("ALLOWED_ORIGINS", "")

	srv := newServer()
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", srv.wsHandler)
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"

	return &gameClients{
		server:     srv,
		testServer: ts,
		wsURL:      wsURL,
	}
}

func dialWS(t *testing.T, wsURL string) *websocket.Conn {
	t.Helper()

	header := http.Header{}
	header.Set("Origin", "http://127.0.0.1")

	conn, _, err := websocket.DefaultDialer.Dial(wsURL, header)
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}
	t.Cleanup(func() {
		_ = conn.Close()
	})
	return conn
}

func readWSMessage(t *testing.T, conn *websocket.Conn) wsMessage {
	t.Helper()

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read websocket message: %v", err)
	}

	var msg wsMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		t.Fatalf("unmarshal websocket message: %v", err)
	}
	return msg
}

func writeWSMessage(t *testing.T, conn *websocket.Conn, message any) {
	t.Helper()

	data, err := json.Marshal(message)
	if err != nil {
		t.Fatalf("marshal websocket message: %v", err)
	}
	if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
		t.Fatalf("write websocket message: %v", err)
	}
}

func waitForGameCount(t *testing.T, srv *server, want int) {
	t.Helper()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		srv.mu.RLock()
		got := len(srv.games)
		srv.mu.RUnlock()
		if got == want {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}

	srv.mu.RLock()
	got := len(srv.games)
	srv.mu.RUnlock()
	t.Fatalf("expected %d games, got %d", want, got)
}

func setupGame(t *testing.T) *gameClients {
	t.Helper()

	clients := newWSServer(t)

	clients.white = dialWS(t, clients.wsURL)
	writeWSMessage(t, clients.white, map[string]any{
		"type":    "create_game",
		"payload": map[string]any{},
	})

	createdMsg := readWSMessage(t, clients.white)
	if createdMsg.Type != "game_created" {
		t.Fatalf("expected game_created, got %s", createdMsg.Type)
	}

	var createdPayload gameCreatedPayload
	if err := json.Unmarshal(createdMsg.Payload, &createdPayload); err != nil {
		t.Fatalf("unmarshal game_created payload: %v", err)
	}
	if createdPayload.GameID == "" {
		t.Fatal("expected game id in game_created payload")
	}
	if createdPayload.PlayerToken == "" {
		t.Fatal("expected player token in game_created payload")
	}
	if createdPayload.Role != "white" {
		t.Fatalf("expected role white, got %s", createdPayload.Role)
	}

	clients.gameID = createdPayload.GameID
	clients.whiteToken = createdPayload.PlayerToken

	clients.black = dialWS(t, clients.wsURL)
	writeWSMessage(t, clients.black, map[string]any{
		"type": "join_game",
		"payload": map[string]any{
			"gameId": createdPayload.GameID,
		},
	})

	joinedMsg := readWSMessage(t, clients.black)
	if joinedMsg.Type != "game_joined" {
		t.Fatalf("expected game_joined, got %s", joinedMsg.Type)
	}

	var joinedPayload gameJoinedPayload
	if err := json.Unmarshal(joinedMsg.Payload, &joinedPayload); err != nil {
		t.Fatalf("unmarshal game_joined payload: %v", err)
	}
	if joinedPayload.GameID != createdPayload.GameID {
		t.Fatalf("expected game id %s, got %s", createdPayload.GameID, joinedPayload.GameID)
	}
	if joinedPayload.PlayerToken == "" {
		t.Fatal("expected player token in game_joined payload")
	}
	if joinedPayload.Role != "black" {
		t.Fatalf("expected role black, got %s", joinedPayload.Role)
	}

	clients.blackToken = joinedPayload.PlayerToken

	opponentMsg := readWSMessage(t, clients.white)
	if opponentMsg.Type != "opponent_joined" {
		t.Fatalf("expected opponent_joined, got %s", opponentMsg.Type)
	}

	stateMsg := readWSMessage(t, clients.black)
	if stateMsg.Type != "state_sync" {
		t.Fatalf("expected state_sync, got %s", stateMsg.Type)
	}

	var statePayload stateSyncServerPayload
	if err := json.Unmarshal(stateMsg.Payload, &statePayload); err != nil {
		t.Fatalf("unmarshal state_sync payload: %v", err)
	}
	if statePayload.Fen != defaultStartFEN {
		t.Fatalf("expected default FEN, got %s", statePayload.Fen)
	}

	return clients
}

func TestGameClosedWhenCreatorLeaves(t *testing.T) {
	clients := newWSServer(t)

	clients.white = dialWS(t, clients.wsURL)
	writeWSMessage(t, clients.white, map[string]any{
		"type":    "create_game",
		"payload": map[string]any{},
	})

	createdMsg := readWSMessage(t, clients.white)
	if createdMsg.Type != "game_created" {
		t.Fatalf("expected game_created, got %s", createdMsg.Type)
	}

	var createdPayload gameCreatedPayload
	if err := json.Unmarshal(createdMsg.Payload, &createdPayload); err != nil {
		t.Fatalf("unmarshal game_created payload: %v", err)
	}
	if createdPayload.GameID == "" {
		t.Fatal("expected game id in game_created payload")
	}

	_ = clients.white.Close()
	waitForGameCount(t, clients.server, 0)
}

func TestWebSocketMoveFlow(t *testing.T) {
	clients := setupGame(t)

	writeWSMessage(t, clients.white, map[string]any{
		"type": "move",
		"payload": map[string]any{
			"gameId":       clients.gameID,
			"playerToken":  clients.whiteToken,
			"from":         "e2",
			"to":           "e4",
			"clientMoveId": "move-1",
		},
	})

	ackMsg := readWSMessage(t, clients.white)
	if ackMsg.Type != "move_ack" {
		t.Fatalf("expected move_ack, got %s", ackMsg.Type)
	}

	var ackPayload moveAckPayload
	if err := json.Unmarshal(ackMsg.Payload, &ackPayload); err != nil {
		t.Fatalf("unmarshal move_ack payload: %v", err)
	}
	if ackPayload.ClientMoveID != "move-1" {
		t.Fatalf("expected clientMoveId move-1, got %s", ackPayload.ClientMoveID)
	}

	moveMsg := readWSMessage(t, clients.black)
	if moveMsg.Type != "opponent_move" {
		t.Fatalf("expected opponent_move, got %s", moveMsg.Type)
	}

	var movePayload opponentMovePayload
	if err := json.Unmarshal(moveMsg.Payload, &movePayload); err != nil {
		t.Fatalf("unmarshal opponent_move payload: %v", err)
	}
	if movePayload.From != "e2" || movePayload.To != "e4" {
		t.Fatalf("expected move e2->e4, got %s->%s", movePayload.From, movePayload.To)
	}
	if movePayload.ClientMoveID != "move-1" {
		t.Fatalf("expected clientMoveId move-1, got %s", movePayload.ClientMoveID)
	}
}

func TestWebSocketChatAndStateSync(t *testing.T) {
	clients := setupGame(t)

	writeWSMessage(t, clients.black, map[string]any{
		"type": "chat",
		"payload": map[string]any{
			"gameId":      clients.gameID,
			"playerToken": clients.blackToken,
			"message":     "hello",
		},
	})

	chatMsg := readWSMessage(t, clients.white)
	if chatMsg.Type != "opponent_chat" {
		t.Fatalf("expected opponent_chat, got %s", chatMsg.Type)
	}

	var chatPayload opponentChatPayload
	if err := json.Unmarshal(chatMsg.Payload, &chatPayload); err != nil {
		t.Fatalf("unmarshal opponent_chat payload: %v", err)
	}
	if chatPayload.Message != "hello" {
		t.Fatalf("expected chat message hello, got %s", chatPayload.Message)
	}

	writeWSMessage(t, clients.white, map[string]any{
		"type": "state_sync",
		"payload": map[string]any{
			"gameId":      clients.gameID,
			"playerToken": clients.whiteToken,
			"fen":         "8/8/8/8/8/8/8/8 w - - 0 1",
		},
	})

	stateMsg := readWSMessage(t, clients.black)
	if stateMsg.Type != "state_sync" {
		t.Fatalf("expected state_sync, got %s", stateMsg.Type)
	}

	var statePayload stateSyncServerPayload
	if err := json.Unmarshal(stateMsg.Payload, &statePayload); err != nil {
		t.Fatalf("unmarshal state_sync payload: %v", err)
	}
	if statePayload.Fen != "8/8/8/8/8/8/8/8 w - - 0 1" {
		t.Fatalf("expected updated FEN, got %s", statePayload.Fen)
	}
}
