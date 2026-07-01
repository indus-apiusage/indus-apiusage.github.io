const state = {
  payload: null,
  selectedDate: null,
  filterText: "",
};

function qs(selector) {
  return document.querySelector(selector);
}

function normalizeCurrency(currency) {
  return {
    ...currency,
    primaryCode: "CNY",
    primarySymbol: "¥",
    secondaryCode: null,
    secondarySymbol: null,
  };
}

function currencyFormatter(symbol, value) {
  return `${symbol}${Number(value || 0).toFixed(4)}`;
}

function numberFormatter(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function dateTimeFormatter(value) {
  if (!value || value.startsWith("1970-01-01")) {
    return "尚未生成";
  }

  return new Date(value).toLocaleString("zh-CN", {
    hour12: false,
  });
}

function emptyChart(message) {
  return `<div class="chart-empty">${message}</div>`;
}

function displayDays(payload) {
  const days = Array.isArray(payload?.days) ? payload.days : [];
  const firstActiveIndex = days.findIndex((day) => Number(day.requests || 0) > 0);

  if (firstActiveIndex === -1) {
    return days;
  }

  return days.slice(firstActiveIndex);
}

function createLineChart(days) {
  if (!days.length) {
    return emptyChart("暂无可展示的趋势数据");
  }

  const values = days.map((day) => Number(day.primaryCost || 0));
  const maxValue = Math.max(...values, 1);
  const width = 640;
  const height = 240;
  const padding = 28;
  const xStep = days.length === 1 ? 0 : (width - padding * 2) / (days.length - 1);
  const points = days.map((day, index) => {
    const x = padding + xStep * index;
    const y = height - padding - ((day.primaryCost || 0) / maxValue) * (height - padding * 2);
    return { x, y, label: day.date, value: day.primaryCost || 0 };
  });
  const peakIndex = values.indexOf(maxValue);
  const visibleLabelStep = Math.max(1, Math.ceil(84 / Math.max(xStep, 1)));
  const visibleValueLabelIndexes = new Set([0, peakIndex, points.length - 1]);

  for (let index = 0; index < points.length; index += visibleLabelStep) {
    visibleValueLabelIndexes.add(index);
  }

  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const area =
    `${padding},${height - padding} ` +
    points.map((point) => `${point.x},${point.y}`).join(" ") +
    ` ${width - padding},${height - padding}`;

  const labels = points
    .filter((_, index) => index === 0 || index === points.length - 1 || index === Math.floor(points.length / 2))
    .map(
      (point) =>
        `<text class="chart-label" x="${point.x}" y="${height - 8}" text-anchor="middle">${point.label.slice(
          5,
        )}</text>`,
    )
    .join("");

  const dots = points
    .map((point, index) => {
      const shouldShowValue =
        visibleValueLabelIndexes.has(index) &&
        (point.value > 0 || index === peakIndex || points.length <= 7);
      const valueLabelOffset = index % 2 === 0 ? 12 : 24;
      const valueLabelY = Math.max(16, point.y - valueLabelOffset);

      return `
        <circle cx="${point.x}" cy="${point.y}" r="4.5" fill="#c65d2f"></circle>
        ${
          shouldShowValue
            ? `<text class="chart-value" x="${point.x}" y="${valueLabelY}" text-anchor="middle">${point.value.toFixed(
                2,
              )}</text>`
            : ""
        }
      `;
    })
    .join("");

  return `
    <svg class="svg-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="line-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#c65d2f" stop-opacity="0.24"></stop>
          <stop offset="100%" stop-color="#c65d2f" stop-opacity="0"></stop>
        </linearGradient>
      </defs>
      <path d="M ${area}" fill="url(#line-fill)"></path>
      <polyline points="${line}" fill="none" stroke="#c65d2f" stroke-width="3.2" stroke-linecap="round"></polyline>
      ${dots}
      ${labels}
    </svg>
  `;
}

function createBarChart(rows, currency) {
  if (!rows.length) {
    return emptyChart("这个日期还没有成员数据");
  }

  const topRows = rows.slice(0, 8);
  const maxValue = Math.max(...topRows.map((row) => row.primaryCost || 0), 1);

  return `
    <div class="bar-list">
      ${topRows
        .map((row) => {
          const width = ((row.primaryCost || 0) / maxValue) * 100;
          return `
            <div class="bar-row">
              <div class="bar-labels">
                <strong>${row.displayName}</strong>
                <span class="muted">${currencyFormatter(currency.primarySymbol, row.primaryCost)}</span>
              </div>
              <div class="bar-track">
                <div class="bar-fill" style="width: ${width}%"></div>
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderSummaryCards(payload, selectedDay) {
  const currency = normalizeCurrency(payload.currency);
  const topPerson = selectedDay?.people?.[0];

  const cards = [
    {
      label: "当前日期总消耗",
      value: currencyFormatter(currency.primarySymbol, selectedDay?.primaryCost || 0),
      caption: "按人民币直接展示",
    },
    {
      label: "当前日期请求数",
      value: numberFormatter(selectedDay?.requests || 0),
      caption: `输入 ${numberFormatter(selectedDay?.promptTokens || 0)} / 输出 ${numberFormatter(
        selectedDay?.completionTokens || 0,
      )}`,
    },
    {
      label: "活跃成员数",
      value: numberFormatter(selectedDay?.people?.length || 0),
      caption: `全周期活跃 ${numberFormatter(payload.summary.activePeople)}`,
    },
    {
      label: "今日最高消耗成员",
      value: topPerson ? topPerson.displayName : "暂无",
      caption: topPerson
        ? `${currencyFormatter(currency.primarySymbol, topPerson.primaryCost)} / ${numberFormatter(topPerson.requests)} 次`
        : "等待同步",
    },
  ];

  qs("#summary-grid").innerHTML = cards
    .map(
      (card) => `
        <article class="stat-card">
          <small>${card.label}</small>
          <strong>${card.value}</strong>
          <span>${card.caption}</span>
        </article>
      `,
    )
    .join("");
}

function renderSelectedDayCards(payload, selectedDay) {
  const currency = normalizeCurrency(payload.currency);

  const cards = [
    {
      label: "平台额度原值",
      value: numberFormatter(selectedDay?.rawQuota || 0),
      caption: `1 ${currency.primaryCode} = ${numberFormatter(currency.quotaPerUnit)} quota`,
    },
    {
      label: "缓存读取 Tokens",
      value: numberFormatter(selectedDay?.cacheReadTokens || 0),
      caption: "来自日志 other.cache_tokens",
    },
    {
      label: "缓存写入 Tokens",
      value: numberFormatter(selectedDay?.cacheWriteTokens || 0),
      caption: "聚合 cache_creation_tokens 系列字段",
    },
    {
      label: "Top Models",
      value: selectedDay?.models?.length ? selectedDay.models[0].name : "暂无",
      caption: selectedDay?.models?.length
        ? `${numberFormatter(selectedDay.models[0].requests)} 次请求`
        : "等待同步",
    },
  ];

  qs("#selected-day-cards").innerHTML = cards
    .map(
      (card) => `
        <article class="stat-card">
          <small>${card.label}</small>
          <strong>${card.value}</strong>
          <span>${card.caption}</span>
        </article>
      `,
    )
    .join("");
}

function renderPeopleTable(payload, selectedDay) {
  const filterText = state.filterText.trim().toLowerCase();
  const currency = normalizeCurrency(payload.currency);
  const rows = (selectedDay?.people || []).filter((row) => {
    if (!filterText) {
      return true;
    }

    const searchTargets = [
      row.displayName,
      ...(row.tokenNames || []),
      ...(row.models || []).map((model) => model.name),
    ].join(" ");

    return searchTargets.toLowerCase().includes(filterText);
  });

  qs("#people-table-body").innerHTML = rows.length
    ? rows
        .map(
          (row) => `
            <tr>
              <td>
                <div class="person-name">${row.displayName}</div>
              </td>
              <td>
                <div class="token-list">
                  ${(row.tokenNames || [])
                    .map((tokenName) => `<span class="chip chip--subtle">${tokenName}</span>`)
                    .join("")}
                </div>
              </td>
              <td>${numberFormatter(row.requests)}</td>
              <td>
                <strong>${currencyFormatter(currency.primarySymbol, row.primaryCost)}</strong>
              </td>
              <td>${numberFormatter(row.promptTokens)}</td>
              <td>${numberFormatter(row.completionTokens)}</td>
              <td>
                <div>${numberFormatter(row.cacheReadTokens)} 读</div>
                <div class="muted">${numberFormatter(row.cacheWriteTokens)} 写</div>
              </td>
              <td>
                <div class="model-chips">
                  ${(row.models || [])
                    .map(
                      (model) =>
                        `<span class="chip">${model.name} · ${numberFormatter(model.requests)}</span>`,
                    )
                    .join("")}
                </div>
              </td>
            </tr>
          `,
        )
        .join("")
    : `
        <tr>
          <td colspan="8" class="muted">当前筛选条件下没有匹配成员。</td>
        </tr>
      `;
}

function renderWarnings(payload) {
  const panel = qs("#warning-panel");
  const list = qs("#warning-list");

  if (!payload.warnings?.length) {
    panel.hidden = true;
    list.innerHTML = "";
    return;
  }

  panel.hidden = false;
  list.innerHTML = payload.warnings.map((warning) => `<li>${warning}</li>`).join("");
}

function updateDateOptions(payload) {
  const dateInput = qs("#date-select");
  const hint = qs("#date-range-hint");
  const days = displayDays(payload);
  const earliestDate = days[0]?.date || "";
  const latestDate = payload.summary.latestDate || days.at(-1)?.date || "";

  dateInput.min = earliestDate;
  dateInput.max = latestDate;
  state.selectedDate = latestDate || null;
  dateInput.value = state.selectedDate || "";
  hint.textContent =
    earliestDate && latestDate ? `可选范围 ${earliestDate} 至 ${latestDate}` : "暂无可用日期范围";
}

function currentDay(payload) {
  const days = displayDays(payload);
  return days.find((day) => day.date === state.selectedDate) || days.at(-1) || null;
}

function renderDashboard() {
  const payload = state.payload;
  const currency = normalizeCurrency(payload.currency);
  const days = displayDays(payload);
  const selectedDay = currentDay(payload);
  const dateInput = qs("#date-select");
  const hint = qs("#date-range-hint");

  if (state.selectedDate && !days.some((day) => day.date === state.selectedDate)) {
    state.selectedDate = payload.summary.latestDate || days.at(-1)?.date || null;
  }

  dateInput.min = days[0]?.date || "";
  dateInput.max = payload.summary.latestDate || days.at(-1)?.date || "";
  dateInput.value = state.selectedDate || "";
  hint.textContent =
    days.length > 0
      ? `已从首个有请求的日期开始展示，共 ${numberFormatter(days.length)} 天`
      : "暂无可展示的有效日期";

  qs("#generated-at").textContent = dateTimeFormatter(payload.generatedAt);
  qs("#timezone").textContent = payload.source.timezone;
  qs("#scope").textContent = payload.source.scope;
  qs("#base-url").textContent = payload.source.baseUrl;
  qs("#selected-date-meta").textContent = selectedDay
    ? `${selectedDay.date} · 共 ${numberFormatter(selectedDay.people.length)} 位成员有消费记录`
    : "暂无可用日期";

  renderSummaryCards(payload, selectedDay);
  renderSelectedDayCards(payload, selectedDay);
  renderPeopleTable(payload, selectedDay);
  renderWarnings(payload);

  qs("#cost-trend").innerHTML = createLineChart(days);
  qs("#people-ranking").innerHTML = createBarChart(selectedDay?.people || [], currency);
}

async function loadPayload() {
  const response = await fetch("./data/latest.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load dashboard data: ${response.status}`);
  }

  state.payload = await response.json();
}

function wireEvents() {
  qs("#date-select").addEventListener("change", (event) => {
    state.selectedDate = event.target.value;
    renderDashboard();
  });

  qs("#person-filter").addEventListener("input", (event) => {
    state.filterText = event.target.value || "";
    renderDashboard();
  });
}

async function main() {
  await loadPayload();

  if (!state.payload.days.length) {
    updateDateOptions({
      ...state.payload,
      days: [],
    });
  } else {
    updateDateOptions(state.payload);
  }

  wireEvents();
  renderDashboard();
}

main().catch((error) => {
  qs("#summary-grid").innerHTML = `
    <article class="stat-card">
      <small>加载失败</small>
      <strong>Dashboard Error</strong>
      <span>${error.message}</span>
    </article>
  `;
});
