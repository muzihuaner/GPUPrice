# ---- build stage ----
FROM golang:1.26 AS build
WORKDIR /src

COPY go.mod ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /out/gpuprice .

# ---- runtime stage ----
FROM alpine:3.21
RUN adduser -D -u 10001 appuser

WORKDIR /app
COPY --from=build /out/gpuprice /app/gpuprice

RUN mkdir -p /data && chown appuser:appuser /data
VOLUME /data

USER appuser
EXPOSE 8080

ENTRYPOINT ["/app/gpuprice"]
CMD ["-addr=:8080", "-cache=/data/gpu-pricing.json"]
