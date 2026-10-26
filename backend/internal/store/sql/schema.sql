PRAGMA foreign_keys = ON;

-- Identidade vem do Google (`sub` é estável; o e-mail pode mudar).
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email      TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  picture    TEXT NOT NULL DEFAULT '',
  rev        INTEGER NOT NULL DEFAULT 0,   -- contador de mudanças do usuário (cursor da sincronização)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sessão opaca: guardamos só o hash do token (vazamento do banco não vaza sessões).
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Os dados financeiros são documentos JSON sincronizados com o app (que calcula tudo localmente).
-- O servidor só valida, isola por usuário e entrega as mudanças em ordem de `rev`.
-- Exclusão é lógica (deleted_at): o tombstone propaga a exclusão para os outros aparelhos.
CREATE TABLE IF NOT EXISTS entities (
  user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL CHECK (kind IN ('account','category','recurrence','transaction')),
  id         TEXT    NOT NULL,           -- UUIDv7 gerado no app
  rev        INTEGER NOT NULL,
  deleted_at TEXT,
  data       TEXT    NOT NULL,           -- JSON validado em store/validate.go
  PRIMARY KEY (user_id, kind, id)
);
CREATE INDEX IF NOT EXISTS idx_entities_rev ON entities(user_id, rev);

-- Dois aparelhos materializando a mesma recorrência no mesmo dia não duplicam a ocorrência.
CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_recurrence_date
  ON entities(user_id, json_extract(data, '$.recurrence_id'), json_extract(data, '$.date'))
  WHERE kind = 'transaction' AND deleted_at IS NULL AND json_extract(data, '$.recurrence_id') IS NOT NULL;

-- Operações já aplicadas: reenviar o mesmo lote (rede caiu no meio) nunca duplica.
CREATE TABLE IF NOT EXISTS sync_ops (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  op_id      TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, op_id)
);
