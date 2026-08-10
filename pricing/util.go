package pricing

import "math"

// round2 rounds a float to two decimal places.
func round2(v float64) float64 {
	return math.Round(v*100) / 100
}
