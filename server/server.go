package main

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"strings"
	"time"
)

func newServer() *server {
	return &server{
		games:     make(map[string]*game),
		startTime: time.Now(),
		origins:   newOriginChecker(),
	}
}

func (s *server) sendError(c *clientConn, code, message string) {
	c.sendJSON(outgoingMessage{
		Type: "error",
		Payload: map[string]string{
			"code":    code,
			"message": message,
		},
	})
}

func normalizeGameID(input string) (string, error) {
	trimmed := strings.ToUpper(strings.TrimSpace(input))
	if !gameIDRegex.MatchString(trimmed) {
		return "", errors.New("invalid game id")
	}
	return trimmed, nil
}

func generateGameID() (string, error) {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	bytes := make([]byte, 8)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	var builder strings.Builder
	builder.Grow(9)
	for i, b := range bytes {
		if i == 4 {
			builder.WriteByte('-')
		}
		builder.WriteByte(alphabet[int(b)%len(alphabet)])
	}
	return builder.String(), nil
}

func generatePlayerToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func (s *server) allocateGameIDLocked() (string, error) {
	for i := 0; i < maxGameIDRetries; i++ {
		gameID, err := generateGameID()
		if err != nil {
			return "", err
		}
		if _, exists := s.games[gameID]; !exists {
			return gameID, nil
		}
	}
	return "", errors.New("unable to allocate unique game id")
}
