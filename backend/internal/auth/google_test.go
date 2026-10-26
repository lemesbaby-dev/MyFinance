package auth

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"testing"
	"time"
)

var enc = base64.RawURLEncoding

func sign(t *testing.T, key *rsa.PrivateKey, alg string, claims map[string]any) string {
	t.Helper()
	h, _ := json.Marshal(map[string]string{"alg": alg, "kid": "k1"})
	p, _ := json.Marshal(claims)
	msg := enc.EncodeToString(h) + "." + enc.EncodeToString(p)
	sum := sha256.Sum256([]byte(msg))
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, sum[:])
	if err != nil {
		t.Fatal(err)
	}
	return msg + "." + enc.EncodeToString(sig)
}

func TestVerify(t *testing.T) {
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	other, _ := rsa.GenerateKey(rand.Reader, 2048)
	now := time.Unix(1_800_000_000, 0)
	g := &Google{
		ClientID: "cid",
		Now:      func() time.Time { return now },
		Keys: func(context.Context) (map[string]*rsa.PublicKey, error) {
			return map[string]*rsa.PublicKey{"k1": &key.PublicKey}, nil
		},
	}
	good := func() map[string]any {
		return map[string]any{"iss": "https://accounts.google.com", "aud": "cid", "exp": now.Unix() + 3600,
			"sub": "123", "email": "a@x.com", "email_verified": true, "name": "Ana"}
	}
	mut := func(k string, v any) map[string]any { m := good(); m[k] = v; return m }

	c, err := g.Verify(context.Background(), sign(t, key, "RS256", good()))
	if err != nil || c.Sub != "123" || c.Email != "a@x.com" || c.Name != "Ana" {
		t.Fatalf("token válido recusado: %v %+v", err, c)
	}
	bad := map[string]string{
		"aud errada":        sign(t, key, "RS256", mut("aud", "outro")),
		"iss errado":        sign(t, key, "RS256", mut("iss", "evil.com")),
		"expirado":          sign(t, key, "RS256", mut("exp", now.Unix()-3600)),
		"e-mail não verif.": sign(t, key, "RS256", mut("email_verified", false)),
		"sem sub":           sign(t, key, "RS256", mut("sub", "")),
		"assinatura alheia": sign(t, other, "RS256", good()),
		"alg none/HS256":    sign(t, key, "HS256", good()),
		"lixo":              "a.b",
	}
	for name, tok := range bad {
		if _, err := g.Verify(context.Background(), tok); err == nil {
			t.Errorf("%s: token aceito, deveria ser recusado", name)
		}
	}
}
