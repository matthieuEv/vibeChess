package main

import (
	"log"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

func (s *server) cleanupLoop() {
	ticker := time.NewTicker(cleanupInterval)
	defer ticker.Stop()

	for range ticker.C {
		now := time.Now()
		s.mu.Lock()
		for id, game := range s.games {
			if now.Sub(game.lastSeen) > gameIdleTTL {
				delete(s.games, id)
				log.Printf("cleaned up game %s", id)
			}
		}
		s.mu.Unlock()
	}
}

func (s *server) wsHandler(w http.ResponseWriter, r *http.Request) {
	if !s.origins.allowedOrigin(r.Header.Get("Origin")) {
		http.Error(w, "origin not allowed", http.StatusForbidden)
		return
	}

	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return s.origins.allowedOrigin(r.Header.Get("Origin"))
		},
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	client := &clientConn{
		ws:     conn,
		send:   make(chan []byte, 16),
		server: s,
	}

	atomic.AddInt64(&s.activeConnections, 1)
	go client.writePump()
	client.readPump()
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"ok":true}`))
}
