package main

import (
	"compress/gzip"
	"embed"
	"encoding/json"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"strings"
	"time"

	"gpuprice/pricing"
)

//go:embed static
var staticFS embed.FS

func main() {
	addr := flag.String("addr", ":8080", "HTTP listen address")
	cacheFile := flag.String("cache", "data/gpu-pricing.json", "on-disk cache path")
	flag.Parse()

	svc := pricing.NewService(pricing.Config{
		SourceURL: "https://storage.googleapis.com/vast-public-gpu-pricing/gpu-pricing-public.json",
		CacheFile: *cacheFile,
		Refresh:   10 * time.Minute,
	})
	svc.Start()

	mux := http.NewServeMux()
	mux.HandleFunc("/api/gpus", func(w http.ResponseWriter, r *http.Request) {
		view, state := svc.Get()
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		if view == nil {
			http.Error(w, `{"error":"pricing data not available yet: `+state+`"}`, http.StatusServiceUnavailable)
			return
		}
		_ = json.NewEncoder(w).Encode(view)
	})

	sub, err := fs.Sub(staticFS, "static")
	if err != nil {
		log.Fatal(err)
	}
	static := cacheControl(http.FileServer(http.FS(sub)))
	mux.Handle("/", gzipMiddleware(securityHeaders(static)))

	log.Printf("GPUPrice listening on http://localhost%s", *addr)
	if err := http.ListenAndServe(*addr, mux); err != nil {
		log.Fatal(err)
	}
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		next.ServeHTTP(w, r)
	})
}

func cacheControl(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" || r.URL.Path == "/index.html" {
			w.Header().Set("Cache-Control", "no-cache")
		} else {
			w.Header().Set("Cache-Control", "public, max-age=3600")
		}
		next.ServeHTTP(w, r)
	})
}

type gzipResponseWriter struct {
	http.ResponseWriter
	gz *gzip.Writer
}

func (w *gzipResponseWriter) WriteHeader(code int) {
	w.Header().Del("Content-Length")
	w.ResponseWriter.WriteHeader(code)
}

func (w *gzipResponseWriter) Write(b []byte) (int, error) {
	return w.gz.Write(b)
}

func (w *gzipResponseWriter) Flush() {
	_ = w.gz.Flush()
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func gzipMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			next.ServeHTTP(w, r)
			return
		}
		gz := gzip.NewWriter(w)
		defer func() { _ = gz.Close() }()
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Set("Vary", "Accept-Encoding")
		next.ServeHTTP(&gzipResponseWriter{ResponseWriter: w, gz: gz}, r)
	})
}
