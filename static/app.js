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

  let repaint = null;

  window.addEventListener("resize", () => {
    if (repaint) repaint(-1);
  });

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
      '<td class="col-gpu" data-label="GPU">' + esc(g.name) + '<span class="tier-pill">' + esc(g.tier) + "</span></td>" +
      '<td class="col-num" data-label="显存">' + g.vram_gb + " GB</td>" +
      '<td class="col-num" data-label="时价"><span class="cell-v"><span class="price ' + priceClass + '">$' + fmt(g.price_per_hour) + "</span> <span class=\"price-flat\">" + arrow + "</span></span></td>" +
      '<td class="col-num" data-label="月价"><span class="price">$' + fmt(g.price_per_month) + "</span></td>" +
      '<td class="col-score" data-label="性价比"><span class="stars">' + stars(g.score) + "</span></td>" +
      '<td class="col-avail' + availClass + '" data-label="可租">' + g.available + "</td>";
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
    repaint = null;
  }

  function drawChart(g) {
    const t = g.trend;
    chartClose.hidden = false;
    chartTitle.textContent = g.name + " — 价格趋势";
    if (!t || t.length < 2) {
      chartEl.innerHTML = "";
      chartStats.innerHTML = "";
      repaint = null;
      return;
    }

    chartStats.innerHTML =
      '<div class="stat stat-hover" id="hoverStat" hidden>' +
      '<div class="k">历史价格 · <span id="hoverDate">—</span></div>' +
      '<div class="v" id="hoverPrice">—</div>' +
      "</div>" +
      stat("当前时价", "$" + fmt(g.price_per_hour)) +
      stat("月价", "$" + fmt(g.price_per_month)) +
      stat("7 天涨跌", pctChange(t, 7)) +
      stat("90 天最低", "$" + fmt(minTrend(t))) +
      stat("90 天最高", "$" + fmt(maxTrend(t)));

    chartEl.innerHTML =
      '<canvas id="trendCanvas" aria-hidden="true"></canvas>' +
      '<div class="chart-tip" id="chartTip" hidden>' +
      '<div class="chart-tip-date"></div>' +
      '<div class="chart-tip-price"></div>' +
      "</div>";

    const canvas = chartEl.querySelector("#trendCanvas");
    const ctx = canvas.getContext("2d");
    const tip = chartEl.querySelector("#chartTip");
    const hoverStat = chartStats.querySelector("#hoverStat");
    const hoverDate = hoverStat.querySelector("#hoverDate");
    const hoverPrice = hoverStat.querySelector("#hoverPrice");

    const padL = 44;
    const padR = 12;
    const padT = 12;
    const padB = 26;
    const min = minTrend(t);
    const max = maxTrend(t);
    const span = max - min || 1;
    const n = t.length;
    const prices = t.map((p) => p.price);

    let dotCur = null;
    let dotTarget = null;
    let rafId = 0;

    function paint(hoverIdx) {
      const rect = canvas.getBoundingClientRect();
      const cw = Math.max(rect.width, 1);
      const ch = Math.max(rect.height, 1);
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(ch * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);

      const px = (i) => padL + ((cw - padL - padR) * i) / (n - 1);
      const py = (v) => padT + (ch - padT - padB) * (1 - (v - min) / span);

      ctx.font = "10px 'Fira Code', ui-monospace, monospace";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 1;
      const gridYs = [min + span * 0.25, min + span * 0.5, min + span * 0.75];
      for (const gy of gridYs) {
        const yy = py(gy);
        ctx.strokeStyle = "#1E293B";
        ctx.beginPath();
        ctx.moveTo(padL, yy);
        ctx.lineTo(cw - padR, yy);
        ctx.stroke();
        ctx.textAlign = "right";
        ctx.fillStyle = "#64748B";
        ctx.fillText("$" + fmt(gy), padL - 6, yy);
      }

      const traceSmooth = () => {
        for (let i = 0; i < n - 1; i++) {
          const x0 = px(Math.max(0, i - 1));
          const y0 = py(prices[Math.max(0, i - 1)]);
          const x1 = px(i);
          const y1 = py(prices[i]);
          const x2 = px(i + 1);
          const y2 = py(prices[i + 1]);
          const x3 = px(Math.min(n - 1, i + 2));
          const y3 = py(prices[Math.min(n - 1, i + 2)]);
          ctx.bezierCurveTo(
            x1 + (x2 - x0) / 6,
            y1 + (y2 - y0) / 6,
            x2 - (x3 - x1) / 6,
            y2 - (y3 - y1) / 6,
            x2,
            y2
          );
        }
      };

      const grad = ctx.createLinearGradient(0, padT, 0, ch - padB);
      grad.addColorStop(0, "rgba(34, 197, 94, 0.28)");
      grad.addColorStop(1, "rgba(34, 197, 94, 0)");
      ctx.beginPath();
      ctx.moveTo(padL, ch - padB);
      ctx.lineTo(px(0), py(prices[0]));
      traceSmooth();
      ctx.lineTo(px(n - 1), ch - padB);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(px(0), py(prices[0]));
      traceSmooth();
      ctx.strokeStyle = "#22C55E";
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.stroke();

      ctx.font = "11px 'Fira Code', ui-monospace, monospace";
      ctx.fillStyle = "#F8FAFC";
      ctx.textBaseline = "top";
      const labels = [[0, "left"], [Math.floor(n / 2), "center"], [n - 1, "right"]];
      for (const [i, align] of labels) {
        let lx = px(i);
        if (align === "left") lx = Math.max(lx, padL);
        else if (align === "right") lx = Math.min(lx, cw - padR);
        ctx.textAlign = align;
        ctx.fillText(t[i].date.slice(5).replace("-", "/"), lx, ch - padB + 7);
      }

      if (hoverIdx < 0) return;
      const p = t[hoverIdx];
      const hx = dotCur ? dotCur.x : px(hoverIdx);
      const hy = dotCur ? dotCur.y : py(p.price);

      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = "#475569";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hx, padT);
      ctx.lineTo(hx, ch - padB);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(hx, hy, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = "#22C55E";
      ctx.fill();
      ctx.strokeStyle = "#F8FAFC";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      tip.querySelector(".chart-tip-date").textContent = p.date.replace(/-/g, "/");
      tip.querySelector(".chart-tip-price").textContent = "$" + fmt(p.price);
      tip.classList.toggle("flip", hy < 48);
      tip.style.left = ((hx / cw) * 100).toFixed(2) + "%";
      tip.style.top = ((hy / ch) * 100).toFixed(2) + "%";
      tip.removeAttribute("hidden");
      hoverDate.textContent = p.date.replace(/-/g, "/");
      hoverPrice.textContent = "$" + fmt(p.price);
      hoverStat.removeAttribute("hidden");
    }

    function hideTip() {
      tip.setAttribute("hidden", "");
      hoverStat.setAttribute("hidden", "");
    }

    repaint = paint;
    paint(-1);

    const idxOf = (clientX) => {
      const rect = canvas.getBoundingClientRect();
      const lx = clientX - rect.left;
      if (lx < padL - 6 || lx > rect.width - padR + 6) return -1;
      return Math.max(0, Math.min(n - 1, Math.round(((lx - padL) / (rect.width - padL - padR)) * (n - 1))));
    };

    const move = (clientX) => {
      const i = idxOf(clientX);
      if (i < 0) {
        cancelAnimationFrame(rafId);
        hideTip();
        paint(-1);
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const cw = Math.max(rect.width, 1);
      const ch = Math.max(rect.height, 1);
      const ax = (ii) => padL + ((cw - padL - padR) * ii) / (n - 1);
      const ay = (v) => padT + (ch - padT - padB) * (1 - (v - min) / span);
      const tx = ax(i);
      const ty = ay(prices[i]);
      if (!dotCur) dotCur = { x: tx, y: ty };
      dotTarget = { x: tx, y: ty };
      cancelAnimationFrame(rafId);
      const step = () => {
        dotCur.x += (dotTarget.x - dotCur.x) * 0.18;
        dotCur.y += (dotTarget.y - dotCur.y) * 0.18;
        paint(i);
        if (Math.abs(dotCur.x - dotTarget.x) > 0.4 || Math.abs(dotCur.y - dotTarget.y) > 0.4) {
          rafId = requestAnimationFrame(step);
        }
      };
      rafId = requestAnimationFrame(step);
    };

    const leave = () => {
      cancelAnimationFrame(rafId);
      dotCur = null;
      hideTip();
      paint(-1);
    };

    canvas.addEventListener("mousemove", (e) => move(e.clientX));
    canvas.addEventListener("mouseleave", leave);
    canvas.addEventListener("touchmove", (e) => {
      if (e.touches.length) move(e.touches[0].clientX);
    }, { passive: true });
    canvas.addEventListener("touchstart", (e) => {
      if (e.touches.length) move(e.touches[0].clientX);
    }, { passive: true });
    canvas.addEventListener("touchend", leave);
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
