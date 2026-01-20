package main

import (
	"testing"
	"time"
)

func TestNormalizeGameID(t *testing.T) {
	got, err := normalizeGameID(" abcd-1234 ")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "ABCD-1234" {
		t.Fatalf("expected ABCD-1234, got %s", got)
	}

	if _, err := normalizeGameID("invalid"); err == nil {
		t.Fatal("expected error for invalid game id")
	}
}

func TestOriginCheckerAllowLocalhost(t *testing.T) {
	t.Setenv("ALLOWED_ORIGINS", "")
	checker := newOriginChecker()

	if !checker.allowedOrigin("http://localhost:5173") {
		t.Fatal("expected localhost origin to be allowed")
	}
	if !checker.allowedOrigin("http://127.0.0.1:3000") {
		t.Fatal("expected 127.0.0.1 origin to be allowed")
	}
	if checker.allowedOrigin("https://example.com") {
		t.Fatal("expected example.com origin to be denied")
	}
}

func TestOriginCheckerExplicitAllowList(t *testing.T) {
	t.Setenv("ALLOWED_ORIGINS", "https://example.com, https://vibechess.app")
	checker := newOriginChecker()

	if !checker.allowedOrigin("https://example.com") {
		t.Fatal("expected example.com origin to be allowed")
	}
	if checker.allowedOrigin("http://localhost:5173") {
		t.Fatal("expected localhost origin to be denied")
	}
}

func TestRateLimiterWindow(t *testing.T) {
	var limiter rateLimiter
	for i := 0; i < rateLimitCount; i++ {
		if !limiter.allow() {
			t.Fatalf("expected request %d to be allowed", i+1)
		}
	}
	if limiter.allow() {
		t.Fatal("expected rate limiter to block after limit")
	}

	limiter.windowStart = time.Now().Add(-rateLimitWindow * 2)
	if !limiter.allow() {
		t.Fatal("expected rate limiter to reset after window")
	}
}
