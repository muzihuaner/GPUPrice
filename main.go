package main

import (
	"embed"
	"encoding/json"
	"flag"
	"io/fs"
	"log"
	"net/http"
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
	mux.Handle("/", http.FileServer(http.FS(sub)))

	log.Printf("GPUPrice listening on http://localhost%s", *addr)
	if err := http.ListenAndServe(*addr, mux); err != nil {
		log.Fatal(err)
	}
}
