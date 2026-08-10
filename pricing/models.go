package pricing

// Daily is a single day's median rental price for a GPU.
type Daily struct {
	Date   string  `json:"date"`
	Median float64 `json:"median"`
}

// GPU is a raw GPU entry from the source JSON.
type GPU struct {
	Name      string  `json:"name"`
	Slug      string  `json:"slug"`
	Tier      string  `json:"tier"`
	VRAMGB    int     `json:"vram_gb"`
	Available int     `json:"available"`
	Daily     []Daily `json:"daily"`
}

// Source is the top-level shape of the upstream pricing file.
type Source struct {
	Updated string         `json:"updated"`
	Terms   string         `json:"terms"`
	License string         `json:"license"`
	GPUs    map[string]GPU `json:"gpus"`
}

// TrendPoint is a single point of a GPU's historical price trend.
type TrendPoint struct {
	Date  string  `json:"date"`
	Price float64 `json:"price"`
}

// ViewGPU is a computed, frontend-ready GPU row.
type ViewGPU struct {
	Name          string       `json:"name"`
	Slug          string       `json:"slug"`
	Tier          string       `json:"tier"`
	VRAMGB        int          `json:"vram_gb"`
	Available     int          `json:"available"`
	PricePerHour  float64      `json:"price_per_hour"`
	PricePerMonth float64      `json:"price_per_month"`
	Score         int          `json:"score"`
	Trend         []TrendPoint `json:"trend"`
}

// View is the API response returned to the frontend.
type View struct {
	Updated string    `json:"updated"`
	Source  string    `json:"source"`
	GPUs    []ViewGPU `json:"gpus"`
}
