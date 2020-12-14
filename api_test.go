package main

import "testing"

func TestSanitizePathname(t *testing.T) {
	tests := map[string]string{
		"../bad-name": "bad-name",
		"@æſd---":     "d",
		"/etc/passwd": "etc-passwd",
		"some very long text which should not make it to disk in this way": "some-very-long-text-which",
	}
	for i, o := range tests {
		s := sanitizePathname(i, 25)
		if s != o {
			t.Errorf("path not sanitized properly, in: %s, wanted: %v, got: %v", i, o, s)
		}
	}
}

func TestGenerateToken(t *testing.T) {
	t1 := generateToken()
	t2 := generateToken()
	if t1 == t2 {
		t.Error("created two identical tokens, something is wrong")
	}
	if len(t1) != 40 || len(t2) != 40 {
		t.Error("unexpected token length")
	}
}
