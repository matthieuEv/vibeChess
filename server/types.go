package main

import (
	"encoding/json"
	"regexp"
	"sync"
	"time"
)

const (
	maxMessageSize   = 4 * 1024
	rateLimitCount   = 30
	rateLimitWindow  = 10 * time.Second
	cleanupInterval  = 5 * time.Minute
	gameIdleTTL      = 30 * time.Minute
	writeWait        = 10 * time.Second
	pongWait         = 60 * time.Second
	pingPeriod       = (pongWait * 9) / 10
	defaultHTTPPort  = "8080"
	maxGameIDRetries = 10
	defaultStartFEN  = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
)

var gameIDRegex = regexp.MustCompile(`^[A-Z0-9]{4}-[A-Z0-9]{4}$`)

type incomingMessage struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

type outgoingMessage struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

type joinGamePayload struct {
	GameID string `json:"gameId"`
}

type reconnectPayload struct {
	GameID      string `json:"gameId"`
	PlayerToken string `json:"playerToken"`
}

type movePayload struct {
	GameID       string `json:"gameId"`
	PlayerToken  string `json:"playerToken"`
	From         string `json:"from"`
	To           string `json:"to"`
	Promotion    string `json:"promotion,omitempty"`
	ClientMoveID string `json:"clientMoveId,omitempty"`
}

type stateSyncPayload struct {
	GameID      string `json:"gameId"`
	PlayerToken string `json:"playerToken"`
	Fen         string `json:"fen"`
}

type chatPayload struct {
	GameID      string `json:"gameId"`
	PlayerToken string `json:"playerToken"`
	Message     string `json:"message"`
}

type game struct {
	id         string
	whiteToken string
	whiteConn  *clientConn
	blackToken string
	blackConn  *clientConn
	lastFen    string
	lastSeen   time.Time
}

type server struct {
	mu                sync.RWMutex
	games             map[string]*game
	startTime         time.Time
	activeConnections int64
	origins           originChecker
}

type rateLimiter struct {
	windowStart time.Time
	count       int
}

func (r *rateLimiter) allow() bool {
	now := time.Now()
	if r.windowStart.IsZero() || now.Sub(r.windowStart) > rateLimitWindow {
		r.windowStart = now
		r.count = 0
	}
	r.count++
	return r.count <= rateLimitCount
}
