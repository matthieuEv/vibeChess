package main

import (
	"encoding/json"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type clientConn struct {
	ws        *websocket.Conn
	send      chan []byte
	server    *server
	gameID    string
	token     string
	role      string
	limiter   rateLimiter
	closeOnce sync.Once
}

func (c *clientConn) close() {
	c.closeOnce.Do(func() {
		close(c.send)
		_ = c.ws.Close()
	})
}

func (c *clientConn) closeWithPolicyViolation(reason string) {
	c.closeOnce.Do(func() {
		_ = c.ws.WriteControl(
			websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.ClosePolicyViolation, reason),
			time.Now().Add(writeWait),
		)
		close(c.send)
		_ = c.ws.Close()
	})
}

func (c *clientConn) sendJSON(msg outgoingMessage) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	select {
	case c.send <- data:
	default:
		c.close()
	}
}

func (c *clientConn) readPump() {
	defer func() {
		c.server.unregister(c)
		c.close()
	}()

	c.ws.SetReadLimit(maxMessageSize)
	_ = c.ws.SetReadDeadline(time.Now().Add(pongWait))
	c.ws.SetPongHandler(func(string) error {
		_ = c.ws.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, message, err := c.ws.ReadMessage()
		if err != nil {
			break
		}

		if !c.limiter.allow() {
			c.server.sendError(c, "rate_limited", "Rate limit exceeded.")
			c.closeWithPolicyViolation("rate limit exceeded")
			return
		}

		var incoming incomingMessage
		if err := json.Unmarshal(message, &incoming); err != nil {
			c.server.sendError(c, "bad_request", "Invalid message.")
			continue
		}
		if strings.TrimSpace(incoming.Type) == "" {
			c.server.sendError(c, "bad_request", "Missing message type.")
			continue
		}

		c.server.handleMessage(c, incoming)
	}
}

func (c *clientConn) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			_ = c.ws.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				_ = c.ws.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.ws.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.ws.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.ws.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
