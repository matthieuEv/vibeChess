package main

import (
	"net/url"
	"os"
	"strings"
)

type originChecker struct {
	allowLocalhost bool
	allowed        map[string]struct{}
}

func newOriginChecker() originChecker {
	raw := strings.TrimSpace(os.Getenv("ALLOWED_ORIGINS"))
	if raw == "" {
		return originChecker{allowLocalhost: true}
	}
	entries := strings.Split(raw, ",")
	allowed := make(map[string]struct{}, len(entries))
	for _, entry := range entries {
		item := strings.TrimSpace(entry)
		if item == "" {
			continue
		}
		allowed[item] = struct{}{}
	}
	return originChecker{allowed: allowed}
}

func (o originChecker) allowedOrigin(origin string) bool {
	if origin == "" {
		return false
	}
	if o.allowLocalhost {
		parsed, err := url.Parse(origin)
		if err != nil {
			return false
		}
		host := parsed.Hostname()
		return host == "localhost" || host == "127.0.0.1"
	}
	_, ok := o.allowed[origin]
	return ok
}
