all: build

build: *.go
	gofmt -w *.go
	go build

test:
	go test

debug-run: test build
	./connectedharmony -debug

debug-webserver: test/cert.pem
	nginx -c $(shell pwd)/test/nginx.conf

test/cert.pem:
	openssl req -x509 -nodes -newkey rsa:2048 -keyout test/cert.pem -out test/cert.pem -days 365 -subj '/CN=localhost'

.PHONY: all build
