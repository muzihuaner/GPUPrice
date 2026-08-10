package pricing

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

const hoursPerMonth = 730

// Config controls how the service fetches and refreshes pricing data.
type Config struct {
	SourceURL string
	CacheFile string
	Refresh   time.Duration
	Client    *http.Client
}

// Service holds the latest pricing data and refreshes it on a schedule.
type Service struct {
	cfg   Config
	mu    sync.RWMutex
	view  *View
	state string
}

// NewService returns a Service that will fetch data lazily.
func NewService(cfg Config) *Service {
	if cfg.Refresh <= 0 {
		cfg.Refresh = 10 * time.Minute
	}
	if cfg.Client == nil {
		cfg.Client = &http.Client{Timeout: 60 * time.Second}
	}
	return &Service{cfg: cfg}
}

// Start loads cached data (if any) and launches the background refresh loop.
func (s *Service) Start() {
	if s.loadCache() == nil {
		s.mu.Lock()
		s.state = "ok (cached)"
		s.mu.Unlock()
	}
	go s.refreshLoop()
}

// Get returns a snapshot of the current view data.
func (s *Service) Get() (*View, string) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.view, s.state
}

// refreshLoop periodically re-fetches the upstream data.
func (s *Service) refreshLoop() {
	refresh := func() {
		if err := s.fetchAndStore(); err != nil {
			s.mu.Lock()
			s.state = "error: " + err.Error()
			s.mu.Unlock()
		}
	}
	refresh()
	for range time.Tick(s.cfg.Refresh) {
		refresh()
	}
}

// fetchAndStore downloads the source, builds the view and persists a cache.
func (s *Service) fetchAndStore() error {
	raw, err := s.download()
	if err != nil {
		return err
	}
	view, err := s.build(raw)
	if err != nil {
		return err
	}
	s.mu.Lock()
	s.view = view
	s.state = "ok (live)"
	s.mu.Unlock()
	s.saveCache(raw)
	return nil
}

// download fetches the raw upstream JSON body.
func (s *Service) download() ([]byte, error) {
	resp, err := s.cfg.Client.Get(s.cfg.SourceURL)
	if err != nil {
		return nil, fmt.Errorf("fetch %s: %w", s.cfg.SourceURL, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetch %s: status %s", s.cfg.SourceURL, resp.Status)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}
	return body, nil
}

// saveCache writes the raw payload to disk for offline restarts.
func (s *Service) saveCache(raw []byte) {
	if s.cfg.CacheFile == "" {
		return
	}
	if err := os.MkdirAll(filepath.Dir(s.cfg.CacheFile), 0o755); err != nil {
		return
	}
	tmp := s.cfg.CacheFile + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return
	}
	_ = os.Rename(tmp, s.cfg.CacheFile)
}

// loadCache reads a previously saved payload from disk.
func (s *Service) loadCache() error {
	if s.cfg.CacheFile == "" {
		return fmt.Errorf("no cache file configured")
	}
	raw, err := os.ReadFile(s.cfg.CacheFile)
	if err != nil {
		return err
	}
	view, err := s.build(raw)
	if err != nil {
		return err
	}
	s.mu.Lock()
	s.view = view
	s.mu.Unlock()
	return nil
}

// build parses the raw payload and computes the enriched view model.
func (s *Service) build(raw []byte) (*View, error) {
	var src Source
	if err := json.Unmarshal(raw, &src); err != nil {
		return nil, fmt.Errorf("parse source: %w", err)
	}
	view := &View{Updated: src.Updated, Source: s.cfg.SourceURL}
	for _, g := range src.GPUs {
		view.GPUs = append(view.GPUs, buildGPU(g))
	}
	applyScores(view.GPUs)
	return view, nil
}

// buildGPU derives price-per-hour, price-per-month and the trend series.
func buildGPU(g GPU) ViewGPU {
	hour := latestMedian(g.Daily)
	return ViewGPU{
		Name:          g.Name,
		Slug:          g.Slug,
		Tier:          g.Tier,
		VRAMGB:        g.VRAMGB,
		Available:     g.Available,
		PricePerHour:  round2(hour),
		PricePerMonth: round2(hour * hoursPerMonth),
		Trend:         buildTrend(g.Daily),
	}
}

// latestMedian returns the newest non-zero median price (daily is newest-first).
func latestMedian(daily []Daily) float64 {
	for _, d := range daily {
		if d.Median > 0 {
			return d.Median
		}
	}
	return 0
}

// buildTrend converts the daily series into a chronological trend.
func buildTrend(daily []Daily) []TrendPoint {
	n := len(daily)
	points := make([]TrendPoint, 0, n)
	for i := n - 1; i >= 0; i-- {
		d := daily[i]
		if d.Median > 0 {
			points = append(points, TrendPoint{Date: d.Date, Price: d.Median})
		}
	}
	return points
}

// applyScores ranks GPUs by VRAM-per-dollar and assigns stars by percentile.
// Percentile buckets keep outliers (e.g. cheap legacy cards) from crushing the
// whole distribution the way linear min-max normalization would.
func applyScores(gpus []ViewGPU) {
	type scored struct {
		idx   int
		value float64
	}
	var items []scored
	for i := range gpus {
		g := &gpus[i]
		if g.Available <= 0 || g.PricePerHour <= 0 || g.VRAMGB <= 0 {
			g.Score = 0
			continue
		}
		items = append(items, scored{i, float64(g.VRAMGB) / g.PricePerHour})
	}
	sort.Slice(items, func(a, b int) bool { return items[a].value < items[b].value })
	n := len(items)
	for rank, it := range items {
		pct := float64(rank+1) / float64(n)
		score := 1
		switch {
		case pct > 0.80:
			score = 5
		case pct > 0.60:
			score = 4
		case pct > 0.40:
			score = 3
		case pct > 0.20:
			score = 2
		}
		gpus[it.idx].Score = score
	}
}
