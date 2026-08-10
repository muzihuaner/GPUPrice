(() => {
  "use strict";

  const state = {
    data: null,
    selected: null,
    query: "",
    sort: "value",
    minVram: 0,
    tier: "all",
  };

  const $ = (sel) => document.querySelector(sel);
  const rowsEl = $("#gpuRows");
  const emptyEl = $("#emptyState");
  const countEl = $("#resultCount");
  const updatedEl = $("#updatedAt");
  const chartEl = $("#chart");
  const chartTitle = $("#chartTitle");
  const chartPanel = $("#chartPanel");
  const chartStats = $("#chartStats");
  const chartClose = $("#chartClose");

  async function init() {
    $("#searchInput").addEventListener("input", (e) => {
      state.query = e.target.value.trim().toLowerCase();
      render();
    });
    $("#sortSelect").addEventListener("change", (e) => {
      state.sort = e.target.value;
      render();
    });
    $("#vramFilter").addEventListener("change", (e) => {
      state.minVram = parseInt(e.target.value, 10);
      render();
    });
    $("#tierFilter").addEventListener("change", (e) => {
      state.tier = e.target.value;
      render();
    });
    chartClose.addEventListener("click", clearChart);

    try {
      const resp = await fetch("/api/gpus");
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      state.data = await resp.json();
      setStatus("ok", "实时数据");
      updatedEl.textContent = "更新于 " + new Date(state.data.updated).toLocaleString();
      render();
    } catch (err) {
      setStatus("err", "离线");
      countEl.textContent = "加载定价数据失败";
      console.error(err);
    }
  }

  function setStatus(kind, text) {
    $("#statusDot").className = "dot " + kind;
    $("#statusText").textContent = text;
  }

  function filtered() {
    let gpus = state.data.gpus.slice();
    if (state.query) {
      gpus = gpus.filter(
        (g) =>
          g.name.toLowerCase().includes(state.query) ||
          g.slug.toLowerCase().includes(state.query)
      );
    }
    if (state.minVram > 0) gpus = gpus.filter((g) => g.vram_gb >= state.minVram);
    if (state.tier !== "all") gpus = gpus.filter((g) => g.tier === state.tier);

    const sorters = {
      cheapest: (a, b) => (a.price_per_hour || Infinity) - (b.price_per_hour || Infinity),
      value: (a, b) => b.score - a.score || a.price_per_hour - b.price_per_hour,
      vram: (a, b) => b.vram_gb - a.vram_gb || a.price_per_hour - b.price_per_hour,
      name: (a, b) => a.name.localeCompare(b.name),
    };
    gpus.sort(sorters[state.sort] || sorters.value);
    return gpus;
  }

  function render() {
    if (!state.data) return;
    const gpus = filtered();
    countEl.textContent = "共 " + gpus.length + " 款 GPU";

    rowsEl.innerHTML = "";
    emptyEl.hidden = gpus.length > 0;

    const frag = document.createDocumentFragment();
    for (const g of gpus) frag.appendChild(renderRow(g));
    rowsEl.appendChild(frag);

    if (state.selected) {
      const sel = rowsEl.querySelector('tr[data-slug="' + state.selected.slug + '"]');
      if (sel) sel.classList.add("selected");
    }
  }

  function renderRow(g) {
    const tr = document.createElement("tr");
    tr.dataset.slug = g.slug;
    tr.setAttribute("role", "button");
    tr.setAttribute("tabindex", "0");
    tr.setAttribute("aria-label", g.name + "，点击查看价格趋势");
    tr.addEventListener("click", () => selectGPU(g));
    tr.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectGPU(g);
      }
    });

    const change = priceChange(g);
    const priceClass = change > 0 ? "up" : change < 0 ? "down" : "price-flat";
    const arrow = change > 0 ? "\u25B2" : change < 0 ? "\u25BC" : "\u2014";
    const availClass = g.available === 0 ? " avail-0" : "";

    tr.innerHTML =
      '<td class="col-gpu">' + esc(g.name) + '<span class="tier-pill">' + esc(g.tier) + "</span></td>" +
      '<td class="col-num">' + g.vram_gb + " GB</td>" +
      '<td class="col-num"><span class="price ' + priceClass + '">$' + fmt(g.price_per_hour) + "</span> <span class=\"price-flat\">" + arrow + "</span></td>" +
      '<td class="col-num price">$' + fmt(g.price_per_month) + "</td>" +
      '<td class="col-score"><span class="stars">' + stars(g.score) + "</span></td>" +
      '<td class="col-avail' + availClass + '">' + g.available + "</td>";
    return tr;
  }

  function priceChange(g) {
    const t = g.trend;
    if (!t || t.length < 2) return 0;
    return round2(t[t.length - 1].price - t[t.length - 2].price);
  }

  function selectGPU(g) {
    if (state.selected && state.selected.slug === g.slug) {
      clearChart();
      return;
    }
    state.selected = g;
    rowsEl.querySelectorAll("tr.selected").forEach((el) => el.classList.remove("selected"));
    const sel = rowsEl.querySelector('tr[data-slug="' + g.slug + '"]');
    if (sel) sel.classList.add("selected");
    drawChart(g);
  }

  function clearChart() {
    state.selected = null;
    chartEl.innerHTML = "";
    chartStats.innerHTML = "";
    chartClose.hidden = true;
    chartTitle.textContent = "点击表格中的 GPU 查看价格趋势";
  }

  function drawChart(g) {
    const t = g.trend;
    chartClose.hidden = false;
    chartTitle.textContent = g.name + " — 价格趋势";
    if (!t || t.length < 2) {
      chartEl.innerHTML = "";
      chartStats.innerHTML = "";
      return;
    }

    chartStats.innerHTML =
      stat("当前时价", "$" + fmt(g.price_per_hour)) +
      stat("月价", "$" + fmt(g.price_per_month)) +
      stat("7 天涨跌", pctChange(t, 7)) +
      stat("90 天最低", "$" + fmt(minTrend(t))) +
      stat("90 天最高", "$" + fmt(maxTrend(t)));

    const W = 600;
    const H = 240;
    const padL = 44;
    const padR = 12;
    const padT = 12;
    const padB = 26;
    const prices = t.map((p) => p.price);
    const min = minTrend(t);
    const max = maxTrend(t);
    const span = max - min || 1;
    const n = t.length;

    const x = (i) => padL + ((W - padL - padR) * i) / (n - 1);
    const y = (v) => padT + (H - padT - padB) * (1 - (v - min) / span);

    const line = prices.map((p, i) => x(i).toFixed(1) + "," + y(p).toFixed(1)).join(" ");
    const area = padL + "," + (H - padB) + " " + line + " " + x(n - 1).toFixed(1) + "," + (H - padB);

    const gridYs = [min + span * 0.25, min + span * 0.5, min + span * 0.75];
    let grids = "";
    let gridLbls = "";
    for (const gy of gridYs) {
      const yy = y(gy).toFixed(1);
      grids += '<line class="grid-line" x1="' + padL + '" y1="' + yy + '" x2="' + (W - padR) + '" y2="' + yy + '"/>';
      gridLbls += '<text class="axis-label" x="' + (padL - 6) + '" y="' + (parseFloat(yy) + 3) + '" text-anchor="end">$' + fmt(gy) + "</text>";
    }

    const dots = [0, Math.floor(n / 2), n - 1]
      .map((i, k) => {
        const d = t[i].date.slice(5).replace("-", "/");
        return (
          '<line class="tooltip-line" x1="' + x(i).toFixed(1) + '" y1="' + padT + '" x2="' + x(i).toFixed(1) + '" y2="' + (H - padB) + '"/>' +
          '<circle class="trend-dot" cx="' + x(i).toFixed(1) + '" cy="' + y(t[i].price).toFixed(1) + '" r="3.5"/>' +
          '<text class="trend-label" x="' + x(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + (k === 0 ? "start" : k === 2 ? "end" : "middle") + '">' + d + "</text>"
        );
      })
      .join("");

    chartEl.innerHTML =
      '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<defs><linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#22C55E" stop-opacity="0.28"/>' +
      '<stop offset="100%" stop-color="#22C55E" stop-opacity="0"/>' +
      "</linearGradient></defs>" +
      grids +
      gridLbls +
      '<polygon class="trend-area" points="' + area + '"/>' +
      '<polyline class="trend-line" points="' + line + '"/>' +
      dots +
      "</svg>";
  }

  function stat(k, v) {
    return '<div class="stat"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + "</div></div>";
  }

  function pctChange(t, days) {
    if (t.length < 2) return "\u2014";
    const last = t[t.length - 1].price;
    const ref = t[Math.max(0, t.length - 1 - days)].price;
    if (!ref) return "\u2014";
    const pct = ((last - ref) / ref) * 100;
    return (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
  }

  function minTrend(t) {
    return Math.min(...t.map((p) => p.price));
  }

  function maxTrend(t) {
    return Math.max(...t.map((p) => p.price));
  }

  function stars(score) {
    if (!score) return '<span class="off">\u2605\u2605\u2605\u2605\u2605</span>';
    let out = "";
    for (let i = 1; i <= 5; i++) out += i <= score ? "\u2605" : '<span class="off">\u2605</span>';
    return out;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  function fmt(v) {
    return (Math.round(v * 100) / 100).toFixed(2);
  }

  function round2(v) {
    return Math.round(v * 100) / 100;
  }

  init();
})();
