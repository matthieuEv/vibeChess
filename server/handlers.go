package main

import (
	"encoding/json"
	"log"
	"strings"
	"sync/atomic"
	"time"
)

func (s *server) handleCreateGame(c *clientConn) {
	s.detachConnection(c)

	token, err := generatePlayerToken()
	if err != nil {
		s.sendError(c, "server_error", "Unable to create player token.")
		return
	}

	s.mu.Lock()
	gameID, err := s.allocateGameIDLocked()
	if err != nil {
		s.mu.Unlock()
		s.sendError(c, "server_error", "Unable to create game.")
		return
	}

	now := time.Now()
	newGame := &game{
		id:         gameID,
		whiteToken: token,
		whiteConn:  c,
		lastFen:    defaultStartFEN,
		lastSeen:   now,
	}
	s.games[gameID] = newGame
	c.gameID = gameID
	c.token = token
	c.role = "white"
	s.mu.Unlock()

	log.Printf("created game %s (white connected)", gameID)
	c.sendJSON(outgoingMessage{
		Type: "game_created",
		Payload: map[string]string{
			"gameId":      gameID,
			"role":        "white",
			"playerToken": token,
		},
	})
}

func (s *server) handleJoinGame(c *clientConn, payload joinGamePayload) {
	s.detachConnection(c)

	gameID, err := normalizeGameID(payload.GameID)
	if err != nil {
		s.sendError(c, "invalid_game_id", "Invalid game code.")
		return
	}

	token, err := generatePlayerToken()
	if err != nil {
		s.sendError(c, "server_error", "Unable to create player token.")
		return
	}

	var (
		opponent *clientConn
		lastFen  string
	)

	s.mu.Lock()
	game, ok := s.games[gameID]
	if !ok {
		s.mu.Unlock()
		s.sendError(c, "game_not_found", "Game not found.")
		return
	}
	if game.blackConn != nil {
		s.mu.Unlock()
		s.sendError(c, "game_full", "Game already has two players.")
		return
	}
	replacingSeat := game.blackToken != ""
	game.blackToken = token
	game.blackConn = c
	game.lastSeen = time.Now()
	c.gameID = gameID
	c.token = token
	c.role = "black"
	opponent = game.whiteConn
	lastFen = game.lastFen
	s.mu.Unlock()

	if replacingSeat {
		log.Printf("player rejoined game %s as black (replacing disconnected player)", gameID)
	} else {
		log.Printf("player joined game %s as black", gameID)
	}
	c.sendJSON(outgoingMessage{
		Type: "game_joined",
		Payload: map[string]string{
			"gameId":      gameID,
			"role":        "black",
			"playerToken": token,
		},
	})

	if opponent != nil {
		opponent.sendJSON(outgoingMessage{
			Type:    "opponent_joined",
			Payload: map[string]any{},
		})
	}

	if lastFen != "" {
		c.sendJSON(outgoingMessage{
			Type: "state_sync",
			Payload: map[string]string{
				"fen": lastFen,
			},
		})
	}
}

func (s *server) handleReconnect(c *clientConn, payload reconnectPayload) {
	gameID, err := normalizeGameID(payload.GameID)
	if err != nil {
		s.sendError(c, "invalid_game_id", "Invalid game code.")
		return
	}
	token := strings.TrimSpace(payload.PlayerToken)
	if token == "" {
		s.sendError(c, "unauthorized", "Missing player token.")
		return
	}
	if c.gameID != "" && c.gameID != gameID {
		s.detachConnection(c)
	}

	var (
		role         string
		opponent     *clientConn
		lastFen      string
		previousConn *clientConn
	)

	s.mu.Lock()
	game, ok := s.games[gameID]
	if !ok {
		s.mu.Unlock()
		s.sendError(c, "game_not_found", "Game not found.")
		return
	}

	switch {
	case token == game.whiteToken:
		role = "white"
		previousConn = game.whiteConn
		game.whiteConn = c
		opponent = game.blackConn
	case token == game.blackToken:
		role = "black"
		previousConn = game.blackConn
		game.blackConn = c
		opponent = game.whiteConn
	default:
		s.mu.Unlock()
		s.sendError(c, "unauthorized", "Invalid player token.")
		return
	}

	game.lastSeen = time.Now()
	lastFen = game.lastFen
	c.gameID = gameID
	c.token = token
	c.role = role
	s.mu.Unlock()

	if previousConn != nil && previousConn != c {
		previousConn.close()
	}

	log.Printf("player reconnected to game %s as %s", gameID, role)
	c.sendJSON(outgoingMessage{
		Type: "reconnected",
		Payload: map[string]string{
			"gameId": gameID,
			"role":   role,
		},
	})

	if opponent != nil {
		opponent.sendJSON(outgoingMessage{
			Type:    "opponent_joined",
			Payload: map[string]any{},
		})
		c.sendJSON(outgoingMessage{
			Type:    "opponent_joined",
			Payload: map[string]any{},
		})
	}

	if lastFen != "" {
		c.sendJSON(outgoingMessage{
			Type: "state_sync",
			Payload: map[string]string{
				"fen": lastFen,
			},
		})
	}
}

func (s *server) validatePlayer(gameID string, token string) (*game, string, *clientConn) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	game, ok := s.games[gameID]
	if !ok {
		return nil, "", nil
	}
	if token == game.whiteToken {
		return game, "white", game.blackConn
	}
	if token == game.blackToken {
		return game, "black", game.whiteConn
	}
	return game, "", nil
}

func (s *server) touchGame(gameID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if game, ok := s.games[gameID]; ok {
		game.lastSeen = time.Now()
	}
}

func (s *server) handleMove(c *clientConn, payload movePayload) {
	gameID, err := normalizeGameID(payload.GameID)
	if err != nil {
		s.sendError(c, "invalid_game_id", "Invalid game code.")
		return
	}
	token := strings.TrimSpace(payload.PlayerToken)
	if token == "" {
		s.sendError(c, "unauthorized", "Missing player token.")
		return
	}

	game, role, opponent := s.validatePlayer(gameID, token)
	if game == nil {
		s.sendError(c, "game_not_found", "Game not found.")
		return
	}
	if role == "" {
		s.sendError(c, "unauthorized", "Invalid player token.")
		return
	}

	s.touchGame(gameID)

	ack := outgoingMessage{
		Type: "move_ack",
		Payload: map[string]string{
			"clientMoveId": payload.ClientMoveID,
		},
	}
	c.sendJSON(ack)

	if opponent != nil {
		out := outgoingMessage{
			Type: "opponent_move",
			Payload: map[string]string{
				"from":         payload.From,
				"to":           payload.To,
				"promotion":    payload.Promotion,
				"clientMoveId": payload.ClientMoveID,
			},
		}
		opponent.sendJSON(out)
	}
}

func (s *server) handleStateSync(c *clientConn, payload stateSyncPayload) {
	gameID, err := normalizeGameID(payload.GameID)
	if err != nil {
		s.sendError(c, "invalid_game_id", "Invalid game code.")
		return
	}
	token := strings.TrimSpace(payload.PlayerToken)
	if token == "" {
		s.sendError(c, "unauthorized", "Missing player token.")
		return
	}
	if strings.TrimSpace(payload.Fen) == "" {
		s.sendError(c, "bad_request", "Missing FEN.")
		return
	}

	game, role, opponent := s.validatePlayer(gameID, token)
	if game == nil {
		s.sendError(c, "game_not_found", "Game not found.")
		return
	}
	if role == "" {
		s.sendError(c, "unauthorized", "Invalid player token.")
		return
	}

	s.mu.Lock()
	game.lastFen = payload.Fen
	game.lastSeen = time.Now()
	s.mu.Unlock()

	if opponent != nil {
		opponent.sendJSON(outgoingMessage{
			Type: "state_sync",
			Payload: map[string]string{
				"fen": payload.Fen,
			},
		})
	}
}

func (s *server) handleChat(c *clientConn, payload chatPayload) {
	gameID, err := normalizeGameID(payload.GameID)
	if err != nil {
		s.sendError(c, "invalid_game_id", "Invalid game code.")
		return
	}
	token := strings.TrimSpace(payload.PlayerToken)
	if token == "" {
		s.sendError(c, "unauthorized", "Missing player token.")
		return
	}
	if strings.TrimSpace(payload.Message) == "" {
		s.sendError(c, "bad_request", "Missing message.")
		return
	}

	game, role, opponent := s.validatePlayer(gameID, token)
	if game == nil {
		s.sendError(c, "game_not_found", "Game not found.")
		return
	}
	if role == "" {
		s.sendError(c, "unauthorized", "Invalid player token.")
		return
	}

	s.touchGame(gameID)

	if opponent != nil {
		opponent.sendJSON(outgoingMessage{
			Type: "opponent_chat",
			Payload: map[string]string{
				"message": payload.Message,
			},
		})
	}
}

func (s *server) handleMessage(c *clientConn, msg incomingMessage) {
	switch msg.Type {
	case "create_game":
		s.handleCreateGame(c)
	case "join_game":
		var payload joinGamePayload
		if err := json.Unmarshal(msg.Payload, &payload); err != nil {
			s.sendError(c, "bad_request", "Invalid join_game payload.")
			return
		}
		s.handleJoinGame(c, payload)
	case "reconnect":
		var payload reconnectPayload
		if err := json.Unmarshal(msg.Payload, &payload); err != nil {
			s.sendError(c, "bad_request", "Invalid reconnect payload.")
			return
		}
		s.handleReconnect(c, payload)
	case "move":
		var payload movePayload
		if err := json.Unmarshal(msg.Payload, &payload); err != nil {
			s.sendError(c, "bad_request", "Invalid move payload.")
			return
		}
		s.handleMove(c, payload)
	case "state_sync":
		var payload stateSyncPayload
		if err := json.Unmarshal(msg.Payload, &payload); err != nil {
			s.sendError(c, "bad_request", "Invalid state_sync payload.")
			return
		}
		s.handleStateSync(c, payload)
	case "chat":
		var payload chatPayload
		if err := json.Unmarshal(msg.Payload, &payload); err != nil {
			s.sendError(c, "bad_request", "Invalid chat payload.")
			return
		}
		s.handleChat(c, payload)
	default:
		s.sendError(c, "unknown_type", "Unknown message type.")
	}
}

func (s *server) unregister(c *clientConn) {
	atomic.AddInt64(&s.activeConnections, -1)

	var opponent *clientConn
	var removedGameID string
	s.mu.Lock()
	if c.gameID != "" {
		if game, ok := s.games[c.gameID]; ok {
			if c.role == "white" && game.whiteConn == c {
				game.whiteConn = nil
				opponent = game.blackConn
			}
			if c.role == "black" && game.blackConn == c {
				game.blackConn = nil
				opponent = game.whiteConn
			}
			game.lastSeen = time.Now()
			if game.whiteConn == nil && game.blackConn == nil {
				removedGameID = game.id
				delete(s.games, game.id)
			}
		}
	}
	s.mu.Unlock()

	if opponent != nil {
		opponent.sendJSON(outgoingMessage{
			Type:    "opponent_left",
			Payload: map[string]any{},
		})
	}
	if removedGameID != "" {
		log.Printf("closed empty game %s", removedGameID)
	}
}

func (s *server) detachConnection(c *clientConn) {
	if c.gameID == "" {
		return
	}

	var opponent *clientConn
	var removedGameID string
	s.mu.Lock()
	if game, ok := s.games[c.gameID]; ok {
		if c.role == "white" && game.whiteConn == c {
			game.whiteConn = nil
			opponent = game.blackConn
		}
		if c.role == "black" && game.blackConn == c {
			game.blackConn = nil
			opponent = game.whiteConn
		}
		game.lastSeen = time.Now()
		if game.whiteConn == nil && game.blackConn == nil {
			removedGameID = game.id
			delete(s.games, game.id)
		}
	}
	c.gameID = ""
	c.role = ""
	c.token = ""
	s.mu.Unlock()

	if opponent != nil {
		opponent.sendJSON(outgoingMessage{
			Type:    "opponent_left",
			Payload: map[string]any{},
		})
	}
	if removedGameID != "" {
		log.Printf("closed empty game %s", removedGameID)
	}
}
