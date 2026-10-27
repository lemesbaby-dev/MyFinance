# Build único: front (Vite) -> back (Go, sem CGO) -> imagem mínima com os dois.
FROM node:22-alpine AS web
WORKDIR /w
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM golang:1.26-alpine AS api
WORKDIR /b
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /financas ./cmd/server

FROM alpine:3.22
RUN adduser -D -u 10001 app && mkdir /data && chown app /data
COPY --from=api /financas /usr/local/bin/financas
COPY --from=web /w/dist /srv/dist
USER app
ENV ADDR=0.0.0.0:8080 DB_PATH=/data/financas.db STATIC_DIR=/srv/dist
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1
ENTRYPOINT ["financas"]
