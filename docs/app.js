const state = {
  payload: null,
  selectedDate: null,
  filterText: "",
  motion: {
    revealObserver: null,
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    starfieldInitialized: false,
    starfieldFrame: 0,
    starfieldParticles: [],
    threeModulePromise: null,
    webgl: null,
    webglInitialized: false,
    tiltEnabled: window.matchMedia("(pointer: fine)").matches,
  },
}

const theme = {
  blue: "#9bbdff",
  pink: "#ff97c5",
  lilac: "#ceb7ff",
  white: "#f0f3ff",
  blueHex: 0x9bbdff,
  pinkHex: 0xff97c5,
  lilacHex: 0xceb7ff,
  whiteHex: 0xf0f3ff,
  shellHex: 0xdfe8ff,
  deepBlueHex: 0x6d8fff,
  slateHex: 0x334667,
  fogHex: 0x0b1019,
  gridHex: 0x4f6898,
  gridBaseHex: 0x141d2b,
}

const memberTokenDisplayOverrides = {
  "蔡俊豪": ["cjh"],
}
const personDisplayNameOverrides = {
  cjh: "\u8521\u4fca\u8c6a",
  cjy: "\u9648\u4fca\u5b87",
  zdy: "\u66fe\u5fb7\u5b87",
}

function qs(selector) {
  return document.querySelector(selector)
}

function qsa(selector) {
  return Array.from(document.querySelectorAll(selector))
}

function setText(selector, value) {
  const element = qs(selector)

  if (element) {
    element.textContent = value
  }
}

function setHTML(selector, value) {
  const element = qs(selector)

  if (element) {
    element.innerHTML = value
  }
}

function normalizeDisplayName(value) {
  const normalizedValue = typeof value === "string" ? value.trim() : ""
  return personDisplayNameOverrides[normalizedValue] || normalizedValue
}

function normalizePersonEntry(person) {
  if (!person) {
    return person
  }

  return {
    ...person,
    displayName: normalizeDisplayName(person.displayName),
  }
}

function normalizeDayEntry(day) {
  if (!day) {
    return day
  }

  return {
    ...day,
    people: Array.isArray(day.people) ? day.people.map(normalizePersonEntry) : day.people,
  }
}

function normalizePayload(payload) {
  if (!payload) {
    return payload
  }

  return {
    ...payload,
    days: Array.isArray(payload.days) ? payload.days.map(normalizeDayEntry) : [],
    people: Array.isArray(payload.people)
      ? payload.people.map((person) => ({
          ...normalizePersonEntry(person),
          days: Array.isArray(person.days) ? person.days.map((day) => ({ ...day })) : [],
        }))
      : [],
    dailyPersonRows: Array.isArray(payload.dailyPersonRows)
      ? payload.dailyPersonRows.map(normalizePersonEntry)
      : [],
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function normalizeCurrency(currency) {
  return {
    ...currency,
    primaryCode: "CNY",
    primarySymbol: "¥",
    secondaryCode: null,
    secondarySymbol: null,
  }
}

function currencyFormatter(symbol, value) {
  return `${symbol}${Number(value || 0).toFixed(4)}`
}

function numberFormatter(value) {
  return Number(value || 0).toLocaleString("en-US")
}

function percentFormatter(value, digits = 2) {
  return `${(Number(value || 0) * 100).toFixed(digits)}%`
}

function dateTimeFormatter(value) {
  if (!value || value.startsWith("1970-01-01")) {
    return "尚未生成"
  }

  return new Date(value).toLocaleString("zh-CN", {
    hour12: false,
  })
}

function emptyChart(message) {
  return `<div class="chart-empty">${message}</div>`
}

function pickPeakDay(days) {
  return [...days].sort((left, right) => (right.primaryCost || 0) - (left.primaryCost || 0))[0] || null
}

function buildBalanceSnapshot(payload, days) {
  const account = payload?.account || {}
  const remainingBalance = Number(account.remainingPrimaryBalance || 0)
  const usedBalance = Number(account.usedPrimaryCost || 0)
  const utilizationRate = Number(account.utilizationRate || 0)
  const latestMonth = Array.isArray(days) ? days.at(-1) : null
  const latestMonthlyBurn = Number(latestMonth?.primaryCost || 0)

  let badge = "余额待观察"
  let badgeTone = "watch"
  let runwayText = "最近月份还没有消耗样本"

  if (remainingBalance <= 0) {
    badge = "需要立即充值"
    badgeTone = "danger"
    runwayText = "当前余额已归零，建议马上补充额度"
  } else if (latestMonthlyBurn > 0) {
    const runwayMonths = remainingBalance / latestMonthlyBurn
    runwayText = `按最近月份消耗约可支撑 ${runwayMonths.toFixed(2)} 个月`

    if (runwayMonths < 1) {
      badge = "建议尽快充值"
      badgeTone = "danger"
    } else if (runwayMonths < 2.5) {
      badge = "建议关注余额"
      badgeTone = "watch"
    } else {
      badge = "余额相对充足"
      badgeTone = "ok"
    }
  } else if (remainingBalance >= 1) {
    badge = "余额已同步"
    badgeTone = "ok"
  }

  return {
    remainingBalance,
    usedBalance,
    utilizationRate,
    badge,
    badgeTone,
    runwayText,
  }
}

function pickTopModel(day) {
  return day?.models?.[0]?.name || "No dominant model"
}

function displayDays(payload) {
  const days = Array.isArray(payload?.days) ? payload.days : []
  const firstActiveIndex = days.findIndex((day) => Number(day.requests || 0) > 0)

  if (firstActiveIndex === -1) {
    return days
  }

  return days.slice(firstActiveIndex)
}

const usageMetricKeys = [
  "requests",
  "rawQuota",
  "primaryCost",
  "promptTokens",
  "completionTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
]

function monthKeyOf(value) {
  return value ? String(value).slice(0, 7) : ""
}

function addUsageMetrics(target, source) {
  usageMetricKeys.forEach((key) => {
    target[key] += Number(source?.[key] || 0)
  })
}

function createModelAggregate(name) {
  return {
    name,
    requests: 0,
    rawQuota: 0,
    primaryCost: 0,
    promptTokens: 0,
    completionTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }
}

function displayTokenNames(entity) {
  const tokenNames = Array.isArray(entity?.tokenNames) ? entity.tokenNames.filter(Boolean) : []
  const normalizedDisplayName = normalizeDisplayName(entity?.displayName)
  const overrideTokenNames =
    normalizedDisplayName === personDisplayNameOverrides.cjh ? ["cjh"] : memberTokenDisplayOverrides[normalizedDisplayName]

  return [...new Set(overrideTokenNames?.length ? overrideTokenNames : tokenNames)]
}

function mergeModelsIntoMap(modelMap, models = []) {
  models.forEach((model) => {
    if (!model?.name) {
      return
    }

    if (!modelMap.has(model.name)) {
      modelMap.set(model.name, createModelAggregate(model.name))
    }

    addUsageMetrics(modelMap.get(model.name), model)
  })
}

function createPersonAggregate(person) {
  return {
    displayName: person.displayName,
    tokenNames: [],
    requests: 0,
    rawQuota: 0,
    primaryCost: 0,
    promptTokens: 0,
    completionTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    models: [],
    _tokenSet: new Set(),
    _modelMap: new Map(),
  }
}

function mergePeopleIntoMap(peopleMap, people = []) {
  people.forEach((person) => {
    if (!person?.displayName) {
      return
    }

    if (!peopleMap.has(person.displayName)) {
      peopleMap.set(person.displayName, createPersonAggregate(person))
    }

    const target = peopleMap.get(person.displayName)
    addUsageMetrics(target, person)

    ;(person.tokenNames || []).forEach((tokenName) => {
      target._tokenSet.add(tokenName)
    })

    mergeModelsIntoMap(target._modelMap, person.models || [])
  })
}

function finalizeModelMap(modelMap) {
  return sortByPrimaryCost([...modelMap.values()].map((model) => ({ ...model })))
}

function finalizePeopleMap(peopleMap) {
  return sortByPrimaryCost(
    [...peopleMap.values()].map((person) => ({
      displayName: person.displayName,
      tokenNames: [...person._tokenSet],
      requests: person.requests,
      rawQuota: person.rawQuota,
      primaryCost: person.primaryCost,
      promptTokens: person.promptTokens,
      completionTokens: person.completionTokens,
      cacheReadTokens: person.cacheReadTokens,
      cacheWriteTokens: person.cacheWriteTokens,
      models: finalizeModelMap(person._modelMap),
    })),
  )
}

function aggregateMonthsFromEntries(entries, options = {}) {
  const { includePeople = false } = options
  const buckets = new Map()

  ;[...entries]
    .sort((left, right) => (left?.date || "").localeCompare(right?.date || ""))
    .forEach((entry) => {
      const monthKey = monthKeyOf(entry?.date)

      if (!monthKey) {
        return
      }

      if (!buckets.has(monthKey)) {
        buckets.set(monthKey, {
          date: monthKey,
          startDate: entry.date,
          endDate: entry.date,
          activeDays: 0,
          requests: 0,
          rawQuota: 0,
          primaryCost: 0,
          promptTokens: 0,
          completionTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          tokenNames: [],
          people: [],
          models: [],
          _tokenSet: new Set(),
          _peopleMap: new Map(),
          _modelMap: new Map(),
        })
      }

      const bucket = buckets.get(monthKey)

      bucket.startDate = bucket.startDate < entry.date ? bucket.startDate : entry.date
      bucket.endDate = bucket.endDate > entry.date ? bucket.endDate : entry.date
      bucket.activeDays += 1

      addUsageMetrics(bucket, entry)
      ;(entry.tokenNames || []).forEach((tokenName) => {
        if (tokenName) {
          bucket._tokenSet.add(tokenName)
        }
      })
      mergeModelsIntoMap(bucket._modelMap, entry.models || [])

      if (includePeople) {
        mergePeopleIntoMap(bucket._peopleMap, entry.people || [])
      }
    })

  return [...buckets.values()].map((bucket) => ({
    date: bucket.date,
    startDate: bucket.startDate,
    endDate: bucket.endDate,
    activeDays: bucket.activeDays,
    requests: bucket.requests,
    rawQuota: bucket.rawQuota,
    primaryCost: bucket.primaryCost,
    promptTokens: bucket.promptTokens,
    completionTokens: bucket.completionTokens,
    cacheReadTokens: bucket.cacheReadTokens,
    cacheWriteTokens: bucket.cacheWriteTokens,
    tokenNames: [...bucket._tokenSet].sort((left, right) => left.localeCompare(right)),
    people: finalizePeopleMap(bucket._peopleMap),
    models: finalizeModelMap(bucket._modelMap),
  }))
}

function displayMonths(payload) {
  return aggregateMonthsFromEntries(displayDays(payload), { includePeople: true })
}

function currentMonthEntry(months) {
  return months.find((month) => month.date === state.selectedDate) || months.at(-1) || null
}

function formatMonthShortLabel(value) {
  return value ? value.slice(2).replace("-", "/") : "-"
}

function createLineChart(days) {
  if (!days.length) {
    return emptyChart("暂无可展示的趋势数据")
  }

  const values = days.map((day) => Number(day.primaryCost || 0))
  const maxValue = Math.max(...values, 1)
  const width = 640
  const height = 240
  const padding = 28
  const xStep = days.length === 1 ? 0 : (width - padding * 2) / (days.length - 1)
  const points = days.map((day, index) => {
    const x = padding + xStep * index
    const y = height - padding - ((day.primaryCost || 0) / maxValue) * (height - padding * 2)
    return { x, y, label: day.date, value: day.primaryCost || 0 }
  })
  const peakIndex = values.indexOf(maxValue)
  const visibleLabelStep = Math.max(1, Math.ceil(84 / Math.max(xStep, 1)))
  const visibleValueLabelIndexes = new Set([0, peakIndex, points.length - 1])

  for (let index = 0; index < points.length; index += visibleLabelStep) {
    visibleValueLabelIndexes.add(index)
  }

  const line = points.map((point) => `${point.x},${point.y}`).join(" ")
  const area =
    `${padding},${height - padding} ` +
    points.map((point) => `${point.x},${point.y}`).join(" ") +
    ` ${width - padding},${height - padding}`

  const labels = points
    .filter((_, index) => index === 0 || index === points.length - 1 || index === Math.floor(points.length / 2))
    .map(
      (point) =>
        `<text class="chart-label" x="${point.x}" y="${height - 8}" text-anchor="middle">${formatMonthShortLabel(
          point.label,
        )}</text>`,
    )
    .join("")

  const dots = points
    .map((point, index) => {
      const shouldShowValue =
        visibleValueLabelIndexes.has(index) &&
        (point.value > 0 || index === peakIndex || points.length <= 7)
      const valueLabelOffset = index % 2 === 0 ? 12 : 24
      const valueLabelY = Math.max(16, point.y - valueLabelOffset)

      return `
        <circle cx="${point.x}" cy="${point.y}" r="4.5" fill="${theme.pink}"></circle>
        ${
          shouldShowValue
            ? `<text class="chart-value" x="${point.x}" y="${valueLabelY}" text-anchor="middle">${point.value.toFixed(
                2,
              )}</text>`
            : ""
        }
      `
    })
    .join("")

  return `
    <svg class="svg-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="line-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="${theme.blue}" stop-opacity="0.26"></stop>
          <stop offset="100%" stop-color="${theme.blue}" stop-opacity="0"></stop>
        </linearGradient>
      </defs>
      <path d="M ${area}" fill="url(#line-fill)"></path>
      <polyline
        points="${line}"
        fill="none"
        stroke="${theme.blue}"
        stroke-width="3.2"
        stroke-linecap="round"
      ></polyline>
      ${dots}
      ${labels}
    </svg>
  `
}

function createBarChart(rows, currency) {
  if (!rows.length) {
    return emptyChart("这个日期还没有成员数据")
  }

  const topRows = rows.slice(0, 8)
  const maxValue = Math.max(...topRows.map((row) => row.primaryCost || 0), 1)

  return `
    <div class="bar-list">
      ${topRows
        .map((row) => {
          const width = ((row.primaryCost || 0) / maxValue) * 100
          return `
            <div class="bar-row">
              <div class="bar-labels">
                <strong>${row.displayName}</strong>
                <span class="muted">${currencyFormatter(currency.primarySymbol, row.primaryCost)}</span>
              </div>
              <div class="bar-track">
                <div class="bar-fill" style="--fill: ${width}%"></div>
              </div>
            </div>
          `
        })
        .join("")}
    </div>
  `
}

function legacyOldRenderHeroMarquee(payload, selectedDay, days) {
  const peakDay = pickPeakDay(days)
  const topModel = pickTopModel(selectedDay)

  qs("#hero-marquee").innerHTML = [
    {
      title: "Live Window",
      body: peakDay ? `${days[0]?.date || "-"} 至 ${days.at(-1)?.date || "-"}` : "等待同步区间",
    },
    {
      title: "Peak Burn",
      body: peakDay ? `${peakDay.date} · ¥${Number(peakDay.primaryCost || 0).toFixed(4)}` : "尚未捕获峰值",
    },
    {
      title: "Dominant Model",
      body: `${topModel} · ${numberFormatter(selectedDay?.requests || 0)} req`,
    },
  ]
    .map(
      (item, index) => `
        <div class="hero-chip reveal-card is-visible" style="--delay: ${80 + index * 60}ms">
          <strong>${item.title}</strong>
          <span>${item.body}</span>
        </div>
      `,
    )
    .join("")
}

function legacyRenderHeroMonthFocus(payload, selectedDay, days) {
  const currency = normalizeCurrency(payload.currency)
  const currentMonth = monthSnapshot(days, selectedDay?.date || payload.summary.latestDate || days.at(-1)?.date)
  const focus = qs("#hero-month-focus")

  if (!focus) {
    return
  }

  focus.innerHTML = currentMonth.endDate
    ? `
        <div class="hero-month-topline">
          <small class="hero-month-kicker">Natural Month Focus</small>
          <span class="hero-month-badge">${formatMonthLabel(currentMonth.endDate)}</span>
        </div>
        <div class="hero-month-metrics">
          <div class="hero-month-primary">
            <span class="hero-month-label">本月累计消耗</span>
            <strong>${currencyFormatter(currency.primarySymbol, currentMonth.primaryCost || 0)}</strong>
            <p>按自然月从 1 号累计到当前查看日。</p>
          </div>
          <div class="hero-month-side">
            <div class="hero-month-stat">
              <span>累计请求</span>
              <strong>${numberFormatter(currentMonth.requests)}</strong>
            </div>
            <div class="hero-month-stat">
              <span>统计区间</span>
              <strong>${formatMonthDayLabel(currentMonth.startDate)} - ${formatMonthDayLabel(currentMonth.endDate)}</strong>
            </div>
          </div>
        </div>
      `
    : `
        <div class="hero-month-empty">
          <small class="hero-month-kicker">Natural Month Focus</small>
          <strong>等待月度数据</strong>
          <p>同步到首个有效请求后，这里会显示自然月累计消耗。</p>
        </div>
      `
}

function renderSceneReadout(payload, selectedDay, days) {
  const peakDay = pickPeakDay(days)
  const topPerson = selectedDay?.people?.[0]
  const requestsPeak = Math.max(...days.map((day) => Number(day.requests || 0)), 1)
  const orbitLoad = Math.round((Number(selectedDay?.requests || 0) / requestsPeak) * 100)

  qs("#scene-readout").innerHTML = [
    {
      label: "Orbit Load",
      value: `${clamp(orbitLoad, 0, 100)}%`,
      note: `${numberFormatter(selectedDay?.requests || 0)} req today`,
    },
    {
      label: "Lead Key",
      value: topPerson?.displayName || "Standby",
      note: topPerson ? currencyFormatter("¥", topPerson.primaryCost) : "当前日期没有活跃成员",
    },
    {
      label: "Model Heat",
      value: pickTopModel(selectedDay),
      note: peakDay ? `peak day ${peakDay.date}` : "等待峰值信号",
    },
  ]
    .map(
      (item, index) => `
        <article class="scene-chip reveal-card" style="--delay: ${160 + index * 70}ms">
          <small>${item.label}</small>
          <strong>${item.value}</strong>
          <span>${item.note}</span>
        </article>
      `,
    )
    .join("")
}

function renderReminderBoard(payload, selectedDay, days) {
  const container = qs("#scene-readout")

  if (!container) {
    return
  }

  const balance = buildBalanceSnapshot(payload, days)
  const topPerson = selectedDay?.people?.[0]
  const monthRange = selectedDay?.startDate && selectedDay?.endDate
    ? `${formatMonthDayLabel(selectedDay.startDate)} - ${formatMonthDayLabel(selectedDay.endDate)}`
    : "等待月份区间"

  container.innerHTML = [
    {
      label: "AAAI 2027",
      valueHtml: `
        <div class="scene-chip__deadline-list">
          <div class="scene-chip__deadline-row">
            <span>摘要截止</span>
            <strong>7月21日</strong>
          </div>
          <div class="scene-chip__deadline-row">
            <span>正式截止</span>
            <strong>7月28日 19:59</strong>
          </div>
        </div>
      `,
      note: "Montreal · 2027-02-16 至 02-23",
      tone: "scene-chip--hot",
      featured: true,
    },
    {
      label: "Balance Signal",
      value: currencyFormatter("¥", balance.remainingBalance),
      note: `${balance.badge} · ${balance.runwayText}`,
      tone: "scene-chip--watch",
    },
    {
      label: "Month Interval",
      value: monthRange,
      note: topPerson
        ? `${topPerson.displayName} 本月领先 · ${currencyFormatter("¥", topPerson.primaryCost || 0)}`
        : selectedDay
          ? `${numberFormatter(selectedDay.requests || 0)} 次请求`
          : "等待月份数据",
      tone: "scene-chip--note",
    },
  ]
    .map(
      (item, index) => `
        <article class="scene-chip scene-chip--horizontal ${item.featured ? "scene-chip--featured" : ""} ${item.empty ? "scene-chip--empty" : ""} ${item.tone || ""} reveal-card" style="--delay: ${160 + index * 70}ms">
          ${
            item.empty
              ? `
                <div class="scene-chip__empty-line" aria-hidden="true"></div>
              `
              : `
          <div class="scene-chip__content">
            <small>${item.label}</small>
            ${item.valueHtml || `<strong>${item.value}</strong>`}
            <span>${item.note}</span>
          </div>
              `
          }
        </article>
      `,
    )
    .join("")
}

function legacyRenderSignalDeck(payload, selectedDay, days) {
  const topPerson = selectedDay?.people?.[0]
  const peakDay = pickPeakDay(days)
  const totalPeople = payload.summary.activePeople || payload.people?.length || 0
  const avgDailyCost =
    days.length > 0
      ? Number(
          (days.reduce((sum, day) => sum + Number(day.primaryCost || 0), 0) / days.length).toFixed(4),
        )
      : 0

  qs("#signal-deck").innerHTML = [
    {
      label: "Peak Day",
      value: peakDay?.date || "N/A",
      note: peakDay
        ? `¥${Number(peakDay.primaryCost || 0).toFixed(4)} / ${numberFormatter(peakDay.requests)} requests`
        : "等待高峰数据",
    },
    {
      label: "Avg Daily Burn",
      value: `¥${avgDailyCost.toFixed(4)}`,
      note: days.length > 0 ? `按 ${numberFormatter(days.length)} 天有效区间计算` : "暂无可计算天数",
    },
    {
      label: "Hot Operator",
      value: topPerson?.displayName || "Standby",
      note: topPerson ? `今日 ¥${Number(topPerson.primaryCost || 0).toFixed(4)}` : "当前日期没有活跃成员",
    },
    {
      label: "Tracked Members",
      value: numberFormatter(totalPeople),
      note: `${numberFormatter(payload.summary.totalRequests || 0)} total requests in ledger`,
    },
  ]
    .map(
      (item, index) => `
        <article class="signal-card interactive-card reveal-card" style="--delay: ${140 + index * 60}ms">
          <small>${item.label}</small>
          <strong>${item.value}</strong>
          <span>${item.note}</span>
        </article>
      `,
    )
    .join("")
}

function legacyRenderSummaryCards(payload, selectedDay, days) {
  const currency = normalizeCurrency(payload.currency)
  const topPerson = selectedDay?.people?.[0]

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
  ]

  qs("#summary-grid").innerHTML = cards
    .map(
      (card, index) => `
        <article class="stat-card interactive-card reveal-card" style="--delay: ${180 + index * 60}ms">
          <small>${card.label}</small>
          <strong class="stat-card__value">${card.value}</strong>
          <span class="stat-card__note">${card.caption}</span>
        </article>
      `,
    )
    .join("")
}

function legacyOldRenderSelectedDayCards(payload, selectedDay) {
  const currency = normalizeCurrency(payload.currency)

  const cards = [
    {
      label: "平台额度原值",
      value: numberFormatter(selectedDay?.rawQuota || 0),
      caption: `1 ${currency.primaryCode} = ${numberFormatter(currency.quotaPerUnit)} quota`,
      valueType: "numeric",
    },
    {
      label: "缓存读取 Tokens",
      value: numberFormatter(selectedDay?.cacheReadTokens || 0),
      caption: "来自日志 other.cache_tokens",
      valueType: "numeric",
    },
    {
      label: "缓存写入 Tokens",
      value: numberFormatter(selectedDay?.cacheWriteTokens || 0),
      caption: "聚合 cache_creation_tokens 系列字段",
      valueType: "numeric",
    },
    {
      label: "Top Models",
      value: selectedDay?.models?.length ? selectedDay.models[0].name : "暂无",
      caption: selectedDay?.models?.length
        ? `${numberFormatter(selectedDay.models[0].requests)} 次请求`
        : "等待同步",
    },
  ]

  qs("#selected-day-cards").innerHTML = cards
    .map((card, index) => {
      const valueLength = String(card.value || "").length
      const sizeClass =
        card.valueType === "numeric"
          ? valueLength >= 11
            ? "stat-card__value--dense"
            : valueLength >= 9
              ? "stat-card__value--compact"
              : ""
          : ""

      return `
        <article class="stat-card interactive-card reveal-card" style="--delay: ${220 + index * 60}ms">
          <small>${card.label}</small>
          <strong class="stat-card__value ${sizeClass}">${card.value}</strong>
          <span class="stat-card__note">${card.caption}</span>
        </article>
      `
    })
    .join("")
}

function renderPeopleTable(payload, selectedDay) {
  const filterText = state.filterText.trim().toLowerCase()
  const currency = normalizeCurrency(payload.currency)
  const rows = (selectedDay?.people || []).filter((row) => {
    if (!filterText) {
      return true
    }

    const searchTargets = [
      row.displayName,
      ...displayTokenNames(row),
      ...(row.models || []).map((model) => model.name),
    ].join(" ")

    return searchTargets.toLowerCase().includes(filterText)
  })

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
                  ${displayTokenNames(row)
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
      `
}

function renderWarnings(payload) {
  const panel = qs("#warning-panel")
  const list = qs("#warning-list")

  if (!payload.warnings?.length) {
    panel.hidden = true
    list.innerHTML = ""
    return
  }

  panel.hidden = false
  list.innerHTML = payload.warnings.map((warning) => `<li>${warning}</li>`).join("")
}

function updateDateOptions(payload) {
  const dateInput = qs("#date-select")
  const hint = qs("#date-range-hint")
  const days = displayMonths(payload)
  const earliestDate = days[0]?.date || ""
  const latestDate = days.at(-1)?.date || ""

  if (dateInput) {
    dateInput.type = "month"
  }

  dateInput.min = earliestDate
  dateInput.max = latestDate
  state.selectedDate = latestDate || null
  dateInput.value = state.selectedDate || ""
  hint.textContent =
    earliestDate && latestDate ? `可选范围 ${earliestDate} 至 ${latestDate}` : "暂无可用日期范围"
}

function currentDay(payload) {
  return currentMonthEntry(displayMonths(payload))
}

function activePage() {
  return document.body.dataset.page || "overview"
}

function formatDayLabel(value) {
  return formatMonthShortLabel(value)
}

function formatLongDay(value) {
  return formatMonthLabel(value)
}

function formatMonthLabel(value) {
  if (!value) {
    return "-"
  }

  return new Date(`${value.slice(0, 7)}-01T00:00:00`).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
  })
}

function formatMonthDayLabel(value) {
  if (!value) {
    return "-"
  }

  return new Date(`${value}T00:00:00`).toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
  })
}

function formatFullDateLabel(value) {
  if (!value) {
    return "-"
  }

  return new Date(`${value}T00:00:00`).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

function latestDailyUsageDay(payload) {
  const dailyDays = Array.isArray(payload?.days) ? payload.days : []
  const latestDate = payload?.summary?.latestDate || ""

  return (
    dailyDays.find((day) => day?.date === latestDate) ||
    [...dailyDays].sort((left, right) => right.date.localeCompare(left.date))[0] ||
    null
  )
}

function monthSnapshot(days, anchorDate) {
  if (!anchorDate) {
    return {
      monthKey: "",
      startDate: null,
      endDate: null,
      days: [],
      primaryCost: 0,
      requests: 0,
    }
  }

  const monthKey = anchorDate.slice(0, 7)
  const monthDays = days.filter((day) => day.date.startsWith(monthKey) && day.date <= anchorDate)

  return {
    monthKey,
    startDate: monthDays[0]?.date || `${monthKey}-01`,
    endDate: anchorDate,
    days: monthDays,
    primaryCost: monthDays.reduce((sum, day) => sum + Number(day.primaryCost || 0), 0),
    requests: monthDays.reduce((sum, day) => sum + Number(day.requests || 0), 0),
  }
}

function matchFilter(filterText, targets) {
  if (!filterText) {
    return true
  }

  return targets.join(" ").toLowerCase().includes(filterText)
}

function sortByPrimaryCost(items, accessor = (item) => item.primaryCost || 0) {
  return [...items].sort((left, right) => Number(accessor(right)) - Number(accessor(left)))
}

function highlightActiveNav() {
  const page = activePage()

  qsa(".nav-link").forEach((link) => {
    link.classList.toggle("is-active", link.dataset.nav === page)
  })
}

function peakEntry(entries, valueKey = "primaryCost") {
  return [...entries].sort((left, right) => Number(right?.[valueKey] || 0) - Number(left?.[valueKey] || 0))[0] || null
}

function quietEntry(entries, valueKey = "primaryCost") {
  return [...entries]
    .filter((item) => Number(item?.[valueKey] || 0) > 0)
    .sort((left, right) => Number(left?.[valueKey] || 0) - Number(right?.[valueKey] || 0))[0] || null
}

function aggregateModels(days) {
  const chronologicalDays = [...days].sort((left, right) => left.date.localeCompare(right.date))
  const names = new Set()

  chronologicalDays.forEach((day) => {
    ;(day.models || []).forEach((model) => {
      names.add(model.name)
    })
  })

  const catalog = [...names].map((name) => ({
    name,
    requests: 0,
    rawQuota: 0,
    primaryCost: 0,
    promptTokens: 0,
    completionTokens: 0,
    days: [],
  }))

  const map = new Map(catalog.map((item) => [item.name, item]))

  chronologicalDays.forEach((day) => {
    const modelMap = new Map((day.models || []).map((model) => [model.name, model]))

    map.forEach((entry, name) => {
      const model = modelMap.get(name)
      const snapshot = {
        date: day.date,
        requests: model?.requests || 0,
        rawQuota: model?.rawQuota || 0,
        primaryCost: model?.primaryCost || 0,
        promptTokens: model?.promptTokens || 0,
        completionTokens: model?.completionTokens || 0,
      }

      entry.days.push(snapshot)

      if (!model) {
        return
      }

      entry.requests += Number(model.requests || 0)
      entry.rawQuota += Number(model.rawQuota || 0)
      entry.primaryCost += Number(model.primaryCost || 0)
      entry.promptTokens += Number(model.promptTokens || 0)
      entry.completionTokens += Number(model.completionTokens || 0)
    })
  })

  return sortByPrimaryCost(catalog).map((entry) => ({
    ...entry,
    peakDay: peakEntry(entry.days),
  }))
}

function aggregateMemberDays(member) {
  return aggregateMonthsFromEntries(member?.days || [])
}

function aggregateMemberModels(member) {
  return aggregateModels(aggregateMemberDays(member))
}

function filteredMembers(payload) {
  const filterText = state.filterText.trim().toLowerCase()
  const members = sortByPrimaryCost(payload.people || [], (member) => member.totals?.primaryCost || 0)

  return members.filter((member) =>
    matchFilter(filterText, [
      member.displayName,
      ...displayTokenNames(member),
      ...aggregateMemberModels(member).map((model) => model.name),
    ]),
  )
}

function filteredModels(days) {
  const filterText = state.filterText.trim().toLowerCase()
  const models = aggregateModels(days)

  return models.filter((model) => matchFilter(filterText, [model.name]))
}

function filteredTimelineDays(days) {
  const filterText = state.filterText.trim().toLowerCase()

  if (!filterText) {
    return [...days]
  }

  return days.filter((day) =>
    matchFilter(filterText, [
      day.date,
      ...(day.people || []).map((person) => person.displayName),
      ...(day.models || []).map((model) => model.name),
    ]),
  )
}

function createSparkline(values, stroke = "#9bbdff") {
  if (!values.length || values.every((value) => Number(value || 0) === 0)) {
    return `<div class="chart-empty">暂无趋势</div>`
  }

  const width = 144
  const height = 44
  const padding = 4
  const maxValue = Math.max(...values, 1)
  const step = values.length === 1 ? 0 : (width - padding * 2) / (values.length - 1)
  const points = values
    .map((value, index) => {
      const x = padding + index * step
      const y = height - padding - (Number(value || 0) / maxValue) * (height - padding * 2)
      return `${x},${y}`
    })
    .join(" ")

  return `
    <svg class="sparkline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <polyline
        points="${points}"
        fill="none"
        stroke="${stroke}"
        stroke-width="3"
        stroke-linecap="round"
        stroke-linejoin="round"
      ></polyline>
    </svg>
  `
}

function createMetricLineChart(items, options) {
  const {
    valueKey,
    emptyMessage,
    stroke = "#9bbdff",
    fill = "rgba(155, 189, 255, 0.18)",
    pointColor = "#ff97c5",
    valueFormatter = (value) => Number(value || 0).toFixed(2),
    labelFormatter = (item) => formatDayLabel(item.date),
  } = options

  if (!items.length) {
    return emptyChart(emptyMessage)
  }

  const values = items.map((item) => Number(item?.[valueKey] || 0))
  const maxValue = Math.max(...values, 1)
  const width = 640
  const height = 240
  const padding = 28
  const xStep = items.length === 1 ? 0 : (width - padding * 2) / (items.length - 1)
  const points = items.map((item, index) => {
    const x = padding + xStep * index
    const y = height - padding - ((item?.[valueKey] || 0) / maxValue) * (height - padding * 2)
    return { x, y, item, value: item?.[valueKey] || 0 }
  })
  const line = points.map((point) => `${point.x},${point.y}`).join(" ")
  const area =
    `${padding},${height - padding} ` +
    points.map((point) => `${point.x},${point.y}`).join(" ") +
    ` ${width - padding},${height - padding}`

  const labels = points
    .filter((_, index) => index === 0 || index === points.length - 1 || index === Math.floor(points.length / 2))
    .map(
      (point) =>
        `<text class="chart-label" x="${point.x}" y="${height - 8}" text-anchor="middle">${labelFormatter(
          point.item,
        )}</text>`,
    )
    .join("")

  const dots = points
    .map((point, index) => {
      const showValue = index === points.length - 1 || point.value === maxValue || index === 0
      const valueY = Math.max(16, point.y - (index % 2 === 0 ? 12 : 24))

      return `
        <circle cx="${point.x}" cy="${point.y}" r="4.5" fill="${pointColor}"></circle>
        ${
          showValue
            ? `<text class="chart-value" x="${point.x}" y="${valueY}" text-anchor="middle">${valueFormatter(
                point.value,
              )}</text>`
            : ""
        }
      `
    })
    .join("")

  return `
    <svg class="svg-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="metric-fill-${valueKey}" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="${fill}" stop-opacity="1"></stop>
          <stop offset="100%" stop-color="${fill}" stop-opacity="0"></stop>
        </linearGradient>
      </defs>
      <path d="M ${area}" fill="url(#metric-fill-${valueKey})"></path>
      <polyline points="${line}" fill="none" stroke="${stroke}" stroke-width="3.2" stroke-linecap="round"></polyline>
      ${dots}
      ${labels}
    </svg>
  `
}

function createModelTrendChart(days, models) {
  if (!days.length || !models.length) {
    return emptyChart("暂无可展示的模型趋势")
  }

  const palette = [theme.blue, theme.pink, theme.lilac, theme.white]
  const width = 640
  const height = 240
  const padding = 28
  const xStep = days.length === 1 ? 0 : (width - padding * 2) / (days.length - 1)
  const maxValue = Math.max(
    ...models.flatMap((model) => model.days.map((day) => Number(day.primaryCost || 0))),
    1,
  )

  const paths = models
    .map((model, index) => {
      const points = model.days.map((day, pointIndex) => {
        const x = padding + xStep * pointIndex
        const y = height - padding - ((day.primaryCost || 0) / maxValue) * (height - padding * 2)
        return { x, y, value: day.primaryCost || 0 }
      })

      const polyline = points.map((point) => `${point.x},${point.y}`).join(" ")
      const lastPoint = points.at(-1)

      return `
        <polyline
          points="${polyline}"
          fill="none"
          stroke="${palette[index % palette.length]}"
          stroke-width="3"
          stroke-linecap="round"
          stroke-linejoin="round"
        ></polyline>
        <circle cx="${lastPoint.x}" cy="${lastPoint.y}" r="4.8" fill="${palette[index % palette.length]}"></circle>
      `
    })
    .join("")

  const labels = days
    .filter((_, index) => index === 0 || index === days.length - 1 || index === Math.floor(days.length / 2))
    .map((day, index, collection) => {
      const actualIndex =
        index === 0 ? 0 : index === collection.length - 1 ? days.length - 1 : Math.floor(days.length / 2)
      const x = padding + xStep * actualIndex
      return `<text class="chart-label" x="${x}" y="${height - 8}" text-anchor="middle">${formatDayLabel(
        day.date,
      )}</text>`
    })
    .join("")

  return `
    <div class="chart-combo">
      <svg class="svg-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
        ${paths}
        ${labels}
      </svg>
      <div class="legend-row">
        ${models
          .map(
            (model, index) => `
              <span class="legend-chip">
                <i style="background:${palette[index % palette.length]}"></i>
                ${model.name}
              </span>
            `,
          )
          .join("")}
      </div>
    </div>
  `
}

function createStackList(rows, options = {}) {
  const {
    valueAccessor = (row) => row.primaryCost || 0,
    labelAccessor = (row) => row.displayName || row.name || row.date,
    noteAccessor = () => "",
    emptyMessage = "暂无可展示的数据",
    formatValue = (value) => `¥${Number(value || 0).toFixed(4)}`,
  } = options

  if (!rows.length) {
    return emptyChart(emptyMessage)
  }

  const maxValue = Math.max(...rows.map((row) => Number(valueAccessor(row) || 0)), 1)

  return rows
    .map((row) => {
      const currentValue = Number(valueAccessor(row) || 0)
      const width = clamp((currentValue / maxValue) * 100, 0, 100)

      return `
        <div class="stack-row">
          <div class="stack-copy">
            <strong>${labelAccessor(row)}</strong>
            <span>${noteAccessor(row)}</span>
          </div>
          <div class="stack-meter">
            <div class="stack-fill" style="--fill:${width}%"></div>
          </div>
          <div class="stack-value">${formatValue(currentValue)}</div>
        </div>
      `
    })
    .join("")
}

function legacyOldRenderCommonFrame(payload, selectedDay, days) {
  const dateInput = qs("#date-select")
  const hint = qs("#date-range-hint")

  if (state.selectedDate && !days.some((day) => day.date === state.selectedDate)) {
    state.selectedDate = payload.summary.latestDate || days.at(-1)?.date || null
  }

  if (dateInput) {
    dateInput.min = days[0]?.date || ""
    dateInput.max = payload.summary.latestDate || days.at(-1)?.date || ""
    dateInput.value = state.selectedDate || ""
  }

  if (hint) {
    hint.textContent =
      days.length > 0
        ? `已从首个有请求的日期开始展示，共 ${numberFormatter(days.length)} 天`
        : "暂无可展示的有效日期"
  }

  setText("#generated-at", dateTimeFormatter(payload.generatedAt))
  setText("#timezone", payload.source.timezone)
  setText("#scope", payload.source.scope)
  setText("#base-url", payload.source.baseUrl)
  setText("#latest-date", payload.summary.latestDate || "No feed")
  setText("#sync-status", selectedDay ? "Telemetry Live" : "Standby")
  highlightActiveNav()
}

function legacyOldRenderMembersPage(payload, selectedDay, days) {
  const members = filteredMembers(payload)
  const featuredMember = members[0] || null
  const peakDay = pickPeakDay(days)
  const memberDays = aggregateMemberDays(featuredMember)
  const memberModels = aggregateMemberModels(featuredMember).slice(0, 5)

  setHTML(
    "#members-hero-marquee",
    [
      {
        title: "Tracked Members",
        body: `${numberFormatter(payload.summary.activePeople || 0)} 位活跃成员`,
      },
      {
        title: "Lead Operator",
        body: featuredMember
          ? `${featuredMember.displayName} · ¥${Number(featuredMember.totals.primaryCost || 0).toFixed(4)}`
          : "暂无匹配成员",
      },
      {
        title: "Peak Day",
        body: peakDay ? `${peakDay.date} · ¥${Number(peakDay.primaryCost || 0).toFixed(4)}` : "等待峰值日",
      },
    ]
      .map(
        (item) => `
          <div class="hero-chip">
            <strong>${item.title}</strong>
            <span>${item.body}</span>
          </div>
        `,
      )
      .join(""),
  )

  setText(
    "#featured-member-meta",
    featuredMember
      ? `${featuredMember.displayName} · ${numberFormatter(featuredMember.totals.requests)} 次请求 · ${numberFormatter(
          featuredMember.tokenNames.length,
        )} 个别名 Key`
      : "当前筛选条件下没有匹配成员",
  )

  setText(
    "#member-trend-meta",
    featuredMember
      ? `${featuredMember.displayName} 从 ${formatLongDay(memberDays[0]?.date)} 到 ${formatLongDay(
          memberDays.at(-1)?.date,
        )}`
      : "暂无成员趋势",
  )

  setHTML(
    "#members-side-panel",
    featuredMember
      ? [
          {
            label: "主力成员",
            value: featuredMember.displayName,
            note: `累计 ¥${Number(featuredMember.totals.primaryCost || 0).toFixed(4)}`,
          },
          {
            label: "活跃跨度",
            value: `${numberFormatter(memberDays.length)} 天`,
            note: `${formatDayLabel(memberDays[0]?.date)} 至 ${formatDayLabel(memberDays.at(-1)?.date)}`,
          },
          {
            label: "主力模型",
            value: memberModels[0]?.name || "暂无",
            note: memberModels[0]
              ? `${numberFormatter(memberModels[0].requests)} 次请求`
              : "等待模型数据",
          },
        ]
          .map(
            (item) => `
              <div class="insight-row">
                <span>${item.label}</span>
                <strong>${item.value}</strong>
                <p>${item.note}</p>
              </div>
            `,
          )
          .join("")
      : emptyChart("暂无匹配成员"),
  )

  setHTML(
    "#member-grid",
    members.length
      ? members
          .map((member, index) => {
            const trend = aggregateMemberDays(member)
            const peak = peakEntry(trend)
            const topModel = aggregateMemberModels(member)[0]

            return `
              <article class="stat-card interactive-card reveal-card">
                <div class="card-topline">
                  <small>${member.displayName}</small>
                  <span class="card-rank">#${String(index + 1).padStart(2, "0")}</span>
                </div>
                <strong>${currencyFormatter("¥", member.totals.primaryCost || 0)}</strong>
                <span>${numberFormatter(member.totals.requests || 0)} 次请求 · ${
                  topModel ? topModel.name : "暂无模型"
                }</span>
                <div class="sparkline-wrap">${createSparkline(
                  trend.map((day) => day.primaryCost || 0),
                  "#9bbdff",
                )}</div>
                <div class="badge-row">
                  <span class="chip chip--subtle">${peak ? peak.date : "No peak"}</span>
                  ${(member.tokenNames || []).map((tokenName) => `<span class="chip">${tokenName}</span>`).join("")}
                </div>
              </article>
            `
          })
          .join("")
      : emptyChart("当前筛选条件下没有成员卡片"),
  )

  setHTML(
    "#member-trend-chart",
    featuredMember
      ? createMetricLineChart(memberDays, {
          valueKey: "primaryCost",
          emptyMessage: "暂无成员趋势",
          stroke: "#9bbdff",
          fill: "rgba(155, 189, 255, 0.22)",
          pointColor: "#ff97c5",
          valueFormatter: (value) => Number(value || 0).toFixed(2),
        })
      : emptyChart("当前筛选条件下没有成员趋势"),
  )

  setHTML(
    "#member-model-stack",
    createStackList(memberModels, {
      labelAccessor: (model) => model.name,
      noteAccessor: (model) => `${numberFormatter(model.requests)} 次请求`,
      emptyMessage: "暂无成员模型偏好",
    }),
  )

  setHTML(
    "#member-day-table-body",
    memberDays.length
      ? [...memberDays]
          .sort((left, right) => right.date.localeCompare(left.date))
          .map(
            (day) => `
              <tr>
                <td>${day.date}</td>
                <td>${featuredMember.displayName}</td>
                <td>
                  <div class="token-list">
                    ${(featuredMember.tokenNames || []).map((tokenName) => `<span class="chip">${tokenName}</span>`).join("")}
                  </div>
                </td>
                <td>${numberFormatter(day.requests)}</td>
                <td><strong>${currencyFormatter("¥", day.primaryCost)}</strong></td>
                <td>${numberFormatter(day.promptTokens)}</td>
                <td>${numberFormatter(day.completionTokens)}</td>
                <td>
                  <div class="model-chips">
                    ${(day.models || [])
                      .map((model) => `<span class="chip chip--subtle">${model.name} · ${numberFormatter(model.requests)}</span>`)
                      .join("")}
                  </div>
                </td>
              </tr>
            `,
          )
          .join("")
      : `
          <tr>
            <td colspan="8" class="muted">当前筛选条件下没有成员日级记录。</td>
          </tr>
        `,
  )
}

function legacyOldRenderModelsPage(payload, selectedDay, days) {
  const models = filteredModels(days)
  const topSeries = models.slice(0, 3)
  const selectedDayModels = sortByPrimaryCost(selectedDay?.models || [])

  setHTML(
    "#models-hero-marquee",
    [
      {
        title: "Tracked Models",
        body: `${numberFormatter(models.length)} 个模型出现在本周期`,
      },
      {
        title: "Dominant Model",
        body: models[0] ? `${models[0].name} · ¥${Number(models[0].primaryCost || 0).toFixed(4)}` : "暂无模型",
      },
      {
        title: "Current Day Focus",
        body: selectedDayModels[0]
          ? `${selectedDayModels[0].name} · ${numberFormatter(selectedDayModels[0].requests)} req`
          : "所选日期暂无模型请求",
      },
    ]
      .map(
        (item) => `
          <div class="hero-chip">
            <strong>${item.title}</strong>
            <span>${item.body}</span>
          </div>
        `,
      )
      .join(""),
  )

  setText(
    "#selected-model-meta",
    models[0]
      ? `${models[0].name} 当前为全周期主导模型，共 ${numberFormatter(models[0].requests)} 次请求`
      : "当前筛选条件下没有模型",
  )

  setHTML(
    "#models-side-panel",
    models.length
      ? [
          {
            label: "头部模型",
            value: models[0].name,
            note: `累计 ¥${Number(models[0].primaryCost || 0).toFixed(4)}`,
          },
          {
            label: "峰值日",
            value: models[0].peakDay?.date || "暂无",
            note: models[0].peakDay
              ? `单日 ¥${Number(models[0].peakDay.primaryCost || 0).toFixed(4)}`
              : "暂无峰值日",
          },
          {
            label: "当日模型数",
            value: numberFormatter(selectedDayModels.length),
            note: selectedDay ? `${selectedDay.date} 的即时快照` : "等待日期数据",
          },
        ]
          .map(
            (item) => `
              <div class="insight-row">
                <span>${item.label}</span>
                <strong>${item.value}</strong>
                <p>${item.note}</p>
              </div>
            `,
          )
          .join("")
      : emptyChart("暂无模型摘要"),
  )

  setHTML(
    "#model-grid",
    models.length
      ? models
          .map(
            (model) => `
              <article class="stat-card interactive-card reveal-card">
                <div class="card-topline">
                  <small>${model.name}</small>
                  <span class="card-rank">${numberFormatter(model.requests)} req</span>
                </div>
                <strong>${currencyFormatter("¥", model.primaryCost || 0)}</strong>
                <span>${numberFormatter(model.promptTokens)} 输入 / ${numberFormatter(
                  model.completionTokens,
                )} 输出</span>
                <div class="sparkline-wrap">${createSparkline(
                  model.days.map((day) => day.primaryCost || 0),
                  "#ff97c5",
                )}</div>
                <div class="badge-row">
                  <span class="chip chip--subtle">${model.peakDay?.date || "No peak"}</span>
                </div>
              </article>
            `,
          )
          .join("")
      : emptyChart("当前筛选条件下没有模型卡片"),
  )

  setHTML("#model-trend-chart", createModelTrendChart(days, topSeries))

  setHTML(
    "#model-day-board",
    createStackList(selectedDayModels, {
      labelAccessor: (model) => model.name,
      noteAccessor: (model) => `${numberFormatter(model.requests)} 次请求`,
      emptyMessage: "所选日期暂无模型分布",
    }),
  )

  setHTML(
    "#model-table-body",
    models.length
      ? models
          .map(
            (model) => `
              <tr>
                <td><strong>${model.name}</strong></td>
                <td>${numberFormatter(model.requests)}</td>
                <td>${currencyFormatter("¥", model.primaryCost)}</td>
                <td>${numberFormatter(model.promptTokens)}</td>
                <td>${numberFormatter(model.completionTokens)}</td>
                <td>${model.peakDay?.date || "-"}</td>
                <td>${model.peakDay ? currencyFormatter("¥", model.peakDay.primaryCost) : "-"}</td>
              </tr>
            `,
          )
          .join("")
      : `
          <tr>
            <td colspan="7" class="muted">当前筛选条件下没有模型表数据。</td>
          </tr>
        `,
  )

  setHTML(
    "#model-daily-log",
    [...days]
      .sort((left, right) => right.date.localeCompare(left.date))
      .map((day) => {
        const topModel = sortByPrimaryCost(day.models || [])[0]
        return `
          <article class="timeline-card interactive-card reveal-card">
            <div class="timeline-topline">
              <span class="timeline-day">${day.date}</span>
              <span class="chip chip--subtle">${numberFormatter(day.requests)} req</span>
            </div>
            <strong>${topModel?.name || "暂无模型"}</strong>
            <span>${topModel ? currencyFormatter("¥", topModel.primaryCost) : "0"}</span>
            <div class="timeline-tags">
              ${(day.models || []).slice(0, 3).map((model) => `<span class="chip">${model.name}</span>`).join("")}
            </div>
          </article>
        `
      })
      .join(""),
  )
}

function legacyOldRenderTimelinePage(payload, selectedDay, days) {
  const timelineDays = filteredTimelineDays(days)
  const peakDays = sortByPrimaryCost(timelineDays).slice(0, 3)
  const quietDay = quietEntry(timelineDays)
  const requestPeak = peakEntry(timelineDays, "requests")

  setHTML(
    "#timeline-hero-marquee",
    [
      {
        title: "Observed Days",
        body: `${numberFormatter(timelineDays.length)} 天有效周期`,
      },
      {
        title: "Peak Burn",
        body: peakDays[0] ? `${peakDays[0].date} · ¥${Number(peakDays[0].primaryCost || 0).toFixed(4)}` : "暂无峰值日",
      },
      {
        title: "Peak Requests",
        body: requestPeak
          ? `${requestPeak.date} · ${numberFormatter(requestPeak.requests)} req`
          : "暂无请求峰值",
      },
    ]
      .map(
        (item) => `
          <div class="hero-chip">
            <strong>${item.title}</strong>
            <span>${item.body}</span>
          </div>
        `,
      )
      .join(""),
  )

  setHTML(
    "#timeline-side-panel",
    [
      {
        label: "平均日消耗",
        value: `¥${(
          timelineDays.reduce((sum, day) => sum + Number(day.primaryCost || 0), 0) / Math.max(timelineDays.length, 1)
        ).toFixed(4)}`,
        note: "按有效日期均值计算",
      },
      {
        label: "最低活跃日",
        value: quietDay?.date || "暂无",
        note: quietDay ? `${currencyFormatter("¥", quietDay.primaryCost)}` : "暂无静默区间",
      },
      {
        label: "当前查看日",
        value: selectedDay?.date || "暂无",
        note: selectedDay ? `${numberFormatter(selectedDay.requests)} 次请求` : "等待日期选择",
      },
    ]
      .map(
        (item) => `
          <div class="insight-row">
            <span>${item.label}</span>
            <strong>${item.value}</strong>
            <p>${item.note}</p>
          </div>
        `,
      )
      .join(""),
  )

  setHTML(
    "#timeline-grid",
    timelineDays.length
      ? [...timelineDays]
          .sort((left, right) => right.date.localeCompare(left.date))
          .map((day) => {
            const topModel = sortByPrimaryCost(day.models || [])[0]
            const fill = peakDays[0]
              ? clamp((Number(day.primaryCost || 0) / Number(peakDays[0].primaryCost || 1)) * 100, 0, 100)
              : 0

            return `
              <article class="timeline-card interactive-card reveal-card">
                <div class="timeline-topline">
                  <span class="timeline-day">${day.date}</span>
                  <span class="chip chip--subtle">${numberFormatter(day.people?.length || 0)} 人活跃</span>
                </div>
                <strong>${currencyFormatter("¥", day.primaryCost)}</strong>
                <span>${numberFormatter(day.requests)} 次请求 · ${topModel?.name || "暂无模型"}</span>
                <div class="timeline-meter">
                  <div class="timeline-meter-fill" style="--fill:${fill}%"></div>
                </div>
              </article>
            `
          })
          .join("")
      : emptyChart("当前筛选条件下没有时间线节点"),
  )

  setHTML(
    "#timeline-cost-chart",
    createMetricLineChart(timelineDays, {
      valueKey: "primaryCost",
      emptyMessage: "暂无时间线消耗曲线",
      stroke: "#9bbdff",
      fill: "rgba(155, 189, 255, 0.22)",
      pointColor: "#ff97c5",
      valueFormatter: (value) => Number(value || 0).toFixed(2),
    }),
  )

  setHTML(
    "#timeline-request-chart",
    createMetricLineChart(timelineDays, {
      valueKey: "requests",
      emptyMessage: "暂无时间线请求曲线",
      stroke: "#ceb7ff",
      fill: "rgba(206, 183, 255, 0.22)",
      pointColor: "#ff97c5",
      valueFormatter: (value) => numberFormatter(value),
    }),
  )

  setHTML(
    "#timeline-table-body",
    timelineDays.length
      ? [...timelineDays]
          .sort((left, right) => right.date.localeCompare(left.date))
          .map((day) => {
            const topModel = sortByPrimaryCost(day.models || [])[0]
            return `
              <tr>
                <td>${day.date}</td>
                <td>${numberFormatter(day.requests)}</td>
                <td><strong>${currencyFormatter("¥", day.primaryCost)}</strong></td>
                <td>${numberFormatter(day.promptTokens)}</td>
                <td>${numberFormatter(day.completionTokens)}</td>
                <td>${topModel?.name || "-"}</td>
                <td>${numberFormatter(day.people?.length || 0)}</td>
              </tr>
            `
          })
          .join("")
      : `
          <tr>
            <td colspan="7" class="muted">当前筛选条件下没有时间线表数据。</td>
          </tr>
        `,
  )

  setHTML(
    "#peak-grid",
    peakDays.length
      ? peakDays
          .map(
            (day) => `
              <article class="signal-card interactive-card reveal-card">
                <small>${formatLongDay(day.date)}</small>
                <strong>${currencyFormatter("¥", day.primaryCost)}</strong>
                <span>${numberFormatter(day.requests)} 次请求 · ${
                  sortByPrimaryCost(day.models || [])[0]?.name || "暂无模型"
                }</span>
              </article>
            `,
          )
          .join("")
      : emptyChart("暂无峰值观察"),
  )
}

function ensureRevealObserver() {
  if (state.motion.revealObserver || !("IntersectionObserver" in window)) {
    return state.motion.revealObserver
  }

  state.motion.revealObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          continue
        }

        entry.target.classList.add("is-visible")
        state.motion.revealObserver.unobserve(entry.target)
      }
    },
    {
      threshold: 0.12,
    },
  )

  return state.motion.revealObserver
}

function observeRevealCards() {
  const observer = ensureRevealObserver()

  document.querySelectorAll(".reveal-card").forEach((element) => {
    if (element.dataset.revealBound) {
      return
    }

    element.dataset.revealBound = "1"

    if (!observer) {
      element.classList.add("is-visible")
      return
    }

    observer.observe(element)
  })
}

function handleTiltMove(event) {
  const card = event.currentTarget
  const rect = card.getBoundingClientRect()
  const ratioX = clamp((event.clientX - rect.left) / rect.width, 0, 1)
  const ratioY = clamp((event.clientY - rect.top) / rect.height, 0, 1)
  const intensity = card.matches(".hero-copy, .hero-scene") ? 1.2 : 0.9
  const rotateX = ((0.5 - ratioY) * 10 * intensity).toFixed(2)
  const rotateY = ((ratioX - 0.5) * 12 * intensity).toFixed(2)

  card.style.setProperty("--tilt-x", `${rotateX}deg`)
  card.style.setProperty("--tilt-y", `${rotateY}deg`)
  card.style.setProperty("--glow-x", `${(ratioX * 100).toFixed(2)}%`)
  card.style.setProperty("--glow-y", `${(ratioY * 100).toFixed(2)}%`)
}

function handleTiltLeave(event) {
  const card = event.currentTarget
  card.style.setProperty("--tilt-x", "0deg")
  card.style.setProperty("--tilt-y", "0deg")
  card.style.setProperty("--glow-x", "28%")
  card.style.setProperty("--glow-y", "18%")
}

function bindInteractiveCards() {
  if (!state.motion.tiltEnabled) {
    return
  }

  document.querySelectorAll(".interactive-card").forEach((card) => {
    if (card.dataset.tiltBound) {
      return
    }

    card.dataset.tiltBound = "1"
    card.addEventListener("pointermove", handleTiltMove)
    card.addEventListener("pointerleave", handleTiltLeave)
  })
}

async function loadThreeModule() {
  if (state.motion.threeModulePromise) {
    return state.motion.threeModulePromise
  }

  state.motion.threeModulePromise = import(
    "https://cdn.jsdelivr.net/npm/three@0.179.1/build/three.module.js"
  )

  return state.motion.threeModulePromise
}

function updateWebGLSceneTelemetry(selectedDay, days) {
  const webgl = state.motion.webgl

  if (!webgl) {
    return
  }

  const requestPeak = Math.max(...days.map((day) => Number(day.requests || 0)), 1)
  const costPeak = Math.max(...days.map((day) => Number(day.primaryCost || 0)), 1)
  const modelPeak = Math.max(...days.map((day) => Number(day.models?.length || 0)), 1)

  const load = clamp(Number(selectedDay?.requests || 0) / requestPeak || 0.28, 0.18, 1.12)
  const heat = clamp(Number(selectedDay?.primaryCost || 0) / costPeak || 0.22, 0.22, 1.18)
  const modelHeat = clamp(Number(selectedDay?.models?.length || 0) / modelPeak || 0.24, 0.24, 1.1)

  webgl.metrics.load = load
  webgl.metrics.heat = heat
  webgl.metrics.modelHeat = modelHeat

  webgl.coreMaterial.emissiveIntensity = 1.2 + heat * 1.85
  webgl.beamMaterial.opacity = 0.1 + heat * 0.14
  webgl.beamCoreMaterial.opacity = 0.2 + heat * 0.22

  webgl.orbitMaterials.forEach((material, index) => {
    material.opacity = clamp(0.12 + load * 0.1 + modelHeat * 0.05 + index * 0.03, 0.12, 0.42)
  })

  webgl.spriteMaterials.forEach((material, index) => {
    material.opacity = clamp(0.28 + heat * 0.32 - index * 0.03, 0.2, 0.78)
  })

  webgl.gridMaterials.forEach((material) => {
    material.opacity = 0.12 + heat * 0.08
  })
}

async function initWebGLScene() {
  if (state.motion.webglInitialized) {
    return
  }

  state.motion.webglInitialized = true

  const stage = qs("#orbital-stage")
  const canvas = qs("#webgl-canvas")

  if (!stage || !canvas) {
    return
  }

  try {
    const THREE = await loadThreeModule()
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    })

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(0x000000, 0)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.12

    if ("outputColorSpace" in renderer) {
      renderer.outputColorSpace = THREE.SRGBColorSpace
    }

    const scene = new THREE.Scene()
    scene.fog = new THREE.FogExp2(theme.fogHex, 0.105)

    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 60)
    camera.position.set(0, 1.2, 7.2)

    const chamber = new THREE.Group()
    chamber.position.y = 0.08
    scene.add(chamber)

    scene.add(new THREE.AmbientLight(theme.blueHex, 0.52))

    const frontLight = new THREE.PointLight(theme.blueHex, 7.2, 26, 2)
    frontLight.position.set(0, 0.2, 0.4)
    chamber.add(frontLight)

    const pinkLight = new THREE.PointLight(theme.pinkHex, 2.9, 18, 2)
    pinkLight.position.set(2.9, 1.3, 1.5)
    chamber.add(pinkLight)

    const lilacLight = new THREE.PointLight(theme.lilacHex, 2.5, 18, 2)
    lilacLight.position.set(-2.5, -0.8, -1.4)
    chamber.add(lilacLight)

    const glowCanvas = document.createElement("canvas")
    glowCanvas.width = 128
    glowCanvas.height = 128
    const glowContext = glowCanvas.getContext("2d")

    if (!glowContext) {
      throw new Error("Glow texture context unavailable")
    }

    const glowGradient = glowContext.createRadialGradient(64, 64, 4, 64, 64, 64)
    glowGradient.addColorStop(0, "rgba(255,255,255,1)")
    glowGradient.addColorStop(0.24, "rgba(255,255,255,0.95)")
    glowGradient.addColorStop(0.5, "rgba(255,255,255,0.35)")
    glowGradient.addColorStop(1, "rgba(255,255,255,0)")
    glowContext.fillStyle = glowGradient
    glowContext.fillRect(0, 0, 128, 128)

    const glowTexture = new THREE.CanvasTexture(glowCanvas)

    const platformMaterial = new THREE.MeshBasicMaterial({
      color: theme.slateHex,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const platform = new THREE.Mesh(new THREE.RingGeometry(1.6, 3.48, 96), platformMaterial)
    platform.rotation.x = -Math.PI / 2
    platform.position.y = -1.28
    chamber.add(platform)

    const grid = new THREE.GridHelper(7.4, 24, theme.gridHex, theme.gridBaseHex)
    grid.position.y = -1.3
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material]
    gridMaterials.forEach((material) => {
      material.transparent = true
      material.opacity = 0.18
    })
    chamber.add(grid)

    const coreMaterial = new THREE.MeshPhysicalMaterial({
      color: theme.shellHex,
      emissive: theme.deepBlueHex,
      emissiveIntensity: 1.8,
      metalness: 0.14,
      roughness: 0.18,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
      transparent: true,
      opacity: 0.92,
    })
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.72, 2), coreMaterial)
    chamber.add(core)

    const shell = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.08, 1),
      new THREE.MeshBasicMaterial({
        color: theme.blueHex,
        wireframe: true,
        transparent: true,
        opacity: 0.16,
      }),
    )
    chamber.add(shell)

    const beamMaterial = new THREE.MeshBasicMaterial({
      color: theme.blueHex,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.18, 5.2, 28, 1, true), beamMaterial)
    chamber.add(beam)

    const beamCoreMaterial = new THREE.MeshBasicMaterial({
      color: theme.whiteHex,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const beamCore = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.05, 5.86, 18), beamCoreMaterial)
    chamber.add(beamCore)

    const spriteMaterials = []

    const coreHaloMaterial = new THREE.SpriteMaterial({
      map: glowTexture,
      color: theme.blueHex,
      transparent: true,
      opacity: 0.52,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const coreHalo = new THREE.Sprite(coreHaloMaterial)
    coreHalo.scale.set(3.8, 3.8, 1)
    chamber.add(coreHalo)
    spriteMaterials.push(coreHaloMaterial)

    const lilacHaloMaterial = new THREE.SpriteMaterial({
      map: glowTexture,
      color: theme.lilacHex,
      transparent: true,
      opacity: 0.24,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const lilacHalo = new THREE.Sprite(lilacHaloMaterial)
    lilacHalo.scale.set(5.8, 5.8, 1)
    chamber.add(lilacHalo)
    spriteMaterials.push(lilacHaloMaterial)

    const orbitMaterials = []
    const orbitNodes = []

    function createOrbitRing({ radius, tiltX, tiltZ, color, satelliteColor, speed, size, phase }) {
      const orbitGroup = new THREE.Group()
      orbitGroup.rotation.x = tiltX
      orbitGroup.rotation.z = tiltZ

      const orbitMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
      orbitMaterials.push(orbitMaterial)

      const orbitMesh = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.018, 12, 180), orbitMaterial)
      orbitGroup.add(orbitMesh)

      const pivot = new THREE.Group()
      pivot.rotation.y = phase

      const satellite = new THREE.Mesh(
        new THREE.SphereGeometry(size, 20, 20),
        new THREE.MeshStandardMaterial({
          color: satelliteColor,
          emissive: satelliteColor,
          emissiveIntensity: 1.5,
          metalness: 0.18,
          roughness: 0.18,
        }),
      )
      satellite.position.x = radius

      const satelliteGlowMaterial = new THREE.SpriteMaterial({
        map: glowTexture,
        color: satelliteColor,
        transparent: true,
        opacity: 0.62,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
      spriteMaterials.push(satelliteGlowMaterial)

      const satelliteGlow = new THREE.Sprite(satelliteGlowMaterial)
      satelliteGlow.scale.set(size * 7.5, size * 7.5, 1)
      satellite.add(satelliteGlow)
      pivot.add(satellite)
      orbitGroup.add(pivot)
      chamber.add(orbitGroup)

      orbitNodes.push({
        orbitGroup,
        pivot,
        satellite,
        speed,
        bobOffset: Math.random() * Math.PI * 2,
      })
    }

    createOrbitRing({
      radius: 2.02,
      tiltX: 0.88,
      tiltZ: 0.1,
      color: theme.blueHex,
      satelliteColor: theme.blueHex,
      speed: 0.64,
      size: 0.13,
      phase: 0.4,
    })
    createOrbitRing({
      radius: 1.46,
      tiltX: 1.12,
      tiltZ: -0.36,
      color: theme.pinkHex,
      satelliteColor: theme.pinkHex,
      speed: -0.92,
      size: 0.12,
      phase: 1.8,
    })
    createOrbitRing({
      radius: 2.66,
      tiltX: 0.72,
      tiltZ: 0.56,
      color: theme.lilacHex,
      satelliteColor: theme.lilacHex,
      speed: 0.44,
      size: 0.14,
      phase: 2.6,
    })

    const shardConfigs = [
      { position: [-2.45, 0.52, 1.1], color: theme.blueHex, scale: 0.24, speed: 0.68 },
      { position: [2.32, 0.94, -0.84], color: theme.pinkHex, scale: 0.28, speed: -0.52 },
      { position: [-1.24, -1.02, -0.58], color: theme.lilacHex, scale: 0.2, speed: 0.78 },
      { position: [2.58, -0.52, 0.88], color: theme.whiteHex, scale: 0.18, speed: -0.64 },
    ]

    const shards = shardConfigs.map((config, index) => {
      const shard = new THREE.Mesh(
        new THREE.OctahedronGeometry(config.scale, 0),
        new THREE.MeshStandardMaterial({
          color: config.color,
          emissive: config.color,
          emissiveIntensity: 0.75,
          metalness: 0.22,
          roughness: 0.16,
          transparent: true,
          opacity: 0.88,
        }),
      )

      shard.position.set(...config.position)
      shard.rotation.set(index * 0.4, index * 0.6, index * 0.2)
      chamber.add(shard)

      return {
        mesh: shard,
        speed: config.speed,
        floatOffset: Math.random() * Math.PI * 2,
      }
    })

    const particleCount = state.motion.reducedMotion ? 120 : 260
    const positions = new Float32Array(particleCount * 3)
    const colors = new Float32Array(particleCount * 3)
    const palette = [
      [0.608, 0.741, 1],
      [1, 0.592, 0.773],
      [0.808, 0.718, 1],
    ]

    for (let index = 0; index < particleCount; index += 1) {
      const radius = 2.2 + Math.random() * 2.4
      const theta = Math.random() * Math.PI * 2
      const phi = Math.random() * Math.PI
      const base = index * 3
      const tone = palette[index % palette.length]

      positions[base] = Math.sin(phi) * Math.cos(theta) * radius
      positions[base + 1] = (Math.cos(phi) * radius) / 1.8
      positions[base + 2] = Math.sin(phi) * Math.sin(theta) * radius
      colors[base] = tone[0]
      colors[base + 1] = tone[1]
      colors[base + 2] = tone[2]
    }

    const particleGeometry = new THREE.BufferGeometry()
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))
    particleGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3))

    const particleMaterial = new THREE.PointsMaterial({
      size: 0.05,
      transparent: true,
      opacity: 0.84,
      depthWrite: false,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    })
    const particles = new THREE.Points(particleGeometry, particleMaterial)
    chamber.add(particles)

    const pointer = {
      currentX: 0,
      currentY: 0,
      targetX: 0,
      targetY: 0,
    }

    function resizeScene() {
      const rect = stage.getBoundingClientRect()
      const width = Math.max(1, rect.width)
      const height = Math.max(1, rect.height)

      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }

    if (!stage.dataset.webglBound) {
      stage.dataset.webglBound = "1"

      stage.addEventListener("pointermove", (event) => {
        const rect = stage.getBoundingClientRect()
        const ratioX = clamp((event.clientX - rect.left) / rect.width, 0, 1)
        const ratioY = clamp((event.clientY - rect.top) / rect.height, 0, 1)

        pointer.targetX = (ratioX - 0.5) * 1.6
        pointer.targetY = (ratioY - 0.5) * 1.2
      })

      stage.addEventListener("pointerleave", () => {
        pointer.targetX = 0
        pointer.targetY = 0
      })
    }

    if ("ResizeObserver" in window) {
      const resizeObserver = new ResizeObserver(() => {
        resizeScene()
      })
      resizeObserver.observe(stage)
    } else {
      window.addEventListener("resize", resizeScene)
    }

    const webgl = {
      renderer,
      scene,
      camera,
      chamber,
      core,
      shell,
      beam,
      beamMaterial,
      beamCore,
      beamCoreMaterial,
      coreHalo,
      lilacHalo,
      coreMaterial,
      orbitMaterials,
      orbitNodes,
      spriteMaterials,
      shards,
      particles,
      platform,
      gridMaterials,
      metrics: {
        load: 0.5,
        heat: 0.6,
        modelHeat: 0.4,
      },
    }

    state.motion.webgl = webgl
    stage.classList.add("is-webgl-ready")
    resizeScene()

    function animate() {
      const elapsed = performance.now() * 0.001
      const motionScale = state.motion.reducedMotion ? 0.28 : 1

      pointer.currentX += (pointer.targetX - pointer.currentX) * 0.06
      pointer.currentY += (pointer.targetY - pointer.currentY) * 0.06

      const { load, heat, modelHeat } = webgl.metrics

      chamber.rotation.y = elapsed * 0.12 * motionScale + pointer.currentX * 0.18
      chamber.rotation.x = -0.2 + pointer.currentY * 0.12

      platform.rotation.z = elapsed * -0.08 * motionScale
      particles.rotation.y = elapsed * 0.05 * motionScale
      particles.rotation.x = elapsed * 0.03 * motionScale

      core.rotation.x = elapsed * 0.34 * motionScale
      core.rotation.y = elapsed * 0.48 * motionScale
      shell.rotation.x = -elapsed * 0.22 * motionScale
      shell.rotation.y = elapsed * 0.16 * motionScale

      const pulse = 1 + Math.sin(elapsed * (2.1 + load)) * 0.038 * heat
      core.scale.setScalar(pulse)
      coreHalo.scale.setScalar(3.5 + Math.sin(elapsed * 2.2 * motionScale) * 0.24 + heat * 0.55)
      lilacHalo.scale.setScalar(5.2 + Math.cos(elapsed * 1.35 * motionScale) * 0.34 + modelHeat * 0.36)

      beam.rotation.y = elapsed * 0.24 * motionScale
      beamCore.rotation.y = -elapsed * 0.18 * motionScale

      webgl.orbitNodes.forEach((node, index) => {
        const orbitSpeed = node.speed * (0.62 + load * 0.76) * motionScale
        node.pivot.rotation.y = elapsed * orbitSpeed + index * 1.2
        node.satellite.position.y = Math.sin(elapsed * 1.65 + node.bobOffset) * 0.08

        const scale = 0.92 + Math.sin(elapsed * 3.2 + node.bobOffset) * 0.08 + heat * 0.05
        node.satellite.scale.setScalar(scale)
      })

      webgl.shards.forEach((shard, index) => {
        shard.mesh.rotation.x += 0.008 * motionScale
        shard.mesh.rotation.y += 0.01 * motionScale
        shard.mesh.position.y += Math.sin(elapsed * 1.7 + shard.floatOffset + index) * 0.0018
      })

      camera.position.x = pointer.currentX * 0.72
      camera.position.y = 1.18 + pointer.currentY * 0.34
      camera.lookAt(0, 0.1, 0)

      renderer.render(scene, camera)
      webgl.frame = window.requestAnimationFrame(animate)
    }

    if (state.payload) {
      updateWebGLSceneTelemetry(currentDay(state.payload), displayMonths(state.payload))
    }

    animate()
  } catch (error) {
    stage.classList.add("is-webgl-fallback")
    console.warn("Three.js chamber unavailable:", error)
  }
}

function initStarfield() {
  if (state.motion.starfieldInitialized) {
    return
  }

  const canvas = qs("#starfield-canvas")
  const context = canvas?.getContext("2d")

  if (!canvas || !context) {
    return
  }

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const pointer = {
    x: window.innerWidth * 0.5,
    y: window.innerHeight * 0.3,
  }

  let width = window.innerWidth
  let height = window.innerHeight

  function buildParticle() {
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      depth: 0.35 + Math.random() * 1.2,
      radius: 0.8 + Math.random() * 1.6,
      vx: -0.12 + Math.random() * 0.24,
      vy: -0.08 + Math.random() * 0.16,
      tone: Math.random() > 0.78 ? "pink" : Math.random() > 0.54 ? "lilac" : "blue",
    }
  }

  function resizeCanvas() {
    width = window.innerWidth
    height = window.innerHeight

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.floor(width * dpr)
    canvas.height = Math.floor(height * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    context.setTransform(dpr, 0, 0, dpr, 0, 0)

    const particleCount = reducedMotion ? 26 : clamp(Math.floor(width / 18), 42, 88)
    state.motion.starfieldParticles = Array.from({ length: particleCount }, buildParticle)
  }

  function particleColor(tone, alpha) {
    if (tone === "pink") {
      return `rgba(255, 151, 197, ${alpha})`
    }

    if (tone === "lilac") {
      return `rgba(206, 183, 255, ${alpha})`
    }

    return `rgba(155, 189, 255, ${alpha})`
  }

  function animate() {
    context.clearRect(0, 0, width, height)

    const projected = state.motion.starfieldParticles.map((particle) => {
      particle.x += particle.vx * particle.depth
      particle.y += particle.vy * particle.depth

      if (particle.x < -40) {
        particle.x = width + 40
      } else if (particle.x > width + 40) {
        particle.x = -40
      }

      if (particle.y < -40) {
        particle.y = height + 40
      } else if (particle.y > height + 40) {
        particle.y = -40
      }

      const parallaxX = (pointer.x - width / 2) * particle.depth * 0.018
      const parallaxY = (pointer.y - height / 2) * particle.depth * 0.012

      return {
        ...particle,
        drawX: particle.x + parallaxX,
        drawY: particle.y + parallaxY,
      }
    })

    for (let index = 0; index < projected.length; index += 1) {
      const current = projected[index]

      for (let offset = 1; offset <= 4; offset += 1) {
        const next = projected[index + offset]

        if (!next) {
          break
        }

        const dx = current.drawX - next.drawX
        const dy = current.drawY - next.drawY
        const distance = Math.hypot(dx, dy)

        if (distance > 110) {
          continue
        }

        context.strokeStyle = particleColor(current.tone, 0.02 + (1 - distance / 110) * 0.08)
        context.lineWidth = 1
        context.beginPath()
        context.moveTo(current.drawX, current.drawY)
        context.lineTo(next.drawX, next.drawY)
        context.stroke()
      }
    }

    for (const particle of projected) {
      context.fillStyle = particleColor(particle.tone, 0.34 + particle.depth * 0.16)
      context.beginPath()
      context.arc(particle.drawX, particle.drawY, particle.radius * particle.depth, 0, Math.PI * 2)
      context.fill()
    }

    state.motion.starfieldFrame = window.requestAnimationFrame(animate)
  }

  window.addEventListener("resize", resizeCanvas)
  window.addEventListener("pointermove", (event) => {
    pointer.x = event.clientX
    pointer.y = event.clientY
  })

  resizeCanvas()
  state.motion.starfieldInitialized = true
  state.motion.starfieldFrame = window.requestAnimationFrame(animate)
}

function refreshMotionEffects() {
  observeRevealCards()
  bindInteractiveCards()
  initStarfield()
  if (activePage() === "overview") {
    void initWebGLScene()
  }
}

function legacyOldRenderDashboard() {
  const payload = state.payload
  const currency = normalizeCurrency(payload.currency)
  const days = displayDays(payload)
  const selectedDay = currentDay(payload)
  const dateInput = qs("#date-select")
  const hint = qs("#date-range-hint")

  if (state.selectedDate && !days.some((day) => day.date === state.selectedDate)) {
    state.selectedDate = payload.summary.latestDate || days.at(-1)?.date || null
  }

  dateInput.min = days[0]?.date || ""
  dateInput.max = payload.summary.latestDate || days.at(-1)?.date || ""
  dateInput.value = state.selectedDate || ""
  hint.textContent =
    days.length > 0
      ? `已从首个有请求的日期开始展示，共 ${numberFormatter(days.length)} 天`
      : "暂无可展示的有效日期"

  qs("#generated-at").textContent = dateTimeFormatter(payload.generatedAt)
  qs("#timezone").textContent = payload.source.timezone
  qs("#scope").textContent = payload.source.scope
  qs("#base-url").textContent = payload.source.baseUrl
  qs("#latest-date").textContent = payload.summary.latestDate || "No feed"
  qs("#sync-status").textContent = selectedDay ? "Telemetry Live" : "Standby"

  if (selectedDay) {
    qs("#selected-date-meta").textContent = `${selectedDay.date} · 共 ${numberFormatter(
      selectedDay.people.length,
    )} 位成员有消费记录`
  } else {
    qs("#selected-date-meta").textContent = "暂无可用日期"
  }

  renderHeroMonthFocus(payload, selectedDay, days)
  renderHeroMarquee(payload, selectedDay, days)
  renderReminderBoard(payload, selectedDay, days)
  renderSignalDeck(payload, selectedDay, days)
  renderSummaryCards(payload, selectedDay, days)
  renderSelectedDayCards(payload, selectedDay)
  renderPeopleTable(payload, selectedDay)
  renderWarnings(payload)

  qs("#cost-trend").innerHTML = createLineChart(days)
  qs("#people-ranking").innerHTML = createBarChart(selectedDay?.people || [], currency)

  updateWebGLSceneTelemetry(selectedDay, days)

  highlightActiveNav()
  refreshMotionEffects()
}

function legacyOldRenderCurrentPage() {
  const payload = state.payload
  const days = displayDays(payload)
  const selectedDay = currentDay(payload)

  if (activePage() === "overview") {
    renderDashboard()
    return
  }

  renderCommonFrame(payload, selectedDay, days)
  renderWarnings(payload)

  if (activePage() === "members") {
    renderMembersPage(payload, selectedDay, days)
  } else if (activePage() === "models") {
    renderModelsPage(payload, selectedDay, days)
  } else if (activePage() === "timeline") {
    renderTimelinePage(payload, selectedDay, days)
  }

  refreshMotionEffects()
}

function applyMonthlyCopy() {
  const dateInput = qs("#date-select")
  const dateLabel = qs('label[for="date-select"]')
  const filterLabel = qs('label[for="person-filter"]')
  const filterInput = qs("#person-filter")
  const heroText = qs(".hero-text")

  if (dateInput) {
    dateInput.type = "month"
  }

  if (dateLabel) {
    dateLabel.textContent = "查看月份"
  }

  if (activePage() === "overview") {
    if (heroText) {
      heroText.textContent =
        "首页聚焦当月视图、全周期峰值和总览态势。你可以把这里当作月度总控台，再从上方跳转到成员、模型和时间线页面，查看更细颗粒度的月级统计结构。"
    }

    if (filterLabel) {
      filterLabel.textContent = "筛选成员 / Key"
    }

    if (filterInput) {
      filterInput.placeholder = "输入成员名、token 名称或模型关键字"
    }

    const costPanel = qs("#cost-trend")?.closest("article")
    const rankingPanel = qs("#people-ranking")?.closest("article")
    const summaryPanel = qs("#selected-day-cards")?.closest("section")
    const detailPanel = qs("#people-table-body")?.closest("section")

    if (costPanel) {
      costPanel.querySelector("h2").textContent = "近期开销趋势"
      costPanel.querySelector("p").textContent = "从首个有请求的月份开始，展示每月人民币消耗。"
    }

    if (rankingPanel) {
      rankingPanel.querySelector("h2").textContent = "当月成员排行"
      rankingPanel.querySelector("p").textContent = "按所选月份统计的成员消耗排行。"
    }

    if (summaryPanel) {
      summaryPanel.querySelector("h2").textContent = "当月汇总"
    }

    if (detailPanel) {
      detailPanel.querySelector("p").textContent = "按 API Key 名称归属展示所选月份明细。"
    }
  } else if (activePage() === "members") {
    if (heroText) {
      heroText.textContent =
        "这一页聚焦成员画像，拆开看每个人的全周期消耗、活跃月份、主力模型和逐月波动，更适合做团队内部归属、对比和复盘。"
    }

    if (filterLabel) {
      filterLabel.textContent = "筛选成员"
    }

    if (filterInput) {
      filterInput.placeholder = "输入成员名、token 名称或模型关键字"
    }

    const gridPanel = qs("#member-grid")?.closest("section")
    const trendPanel = qs("#member-trend-chart")?.closest("article")
    const modelPanel = qs("#member-model-stack")?.closest("article")
    const tablePanel = qs("#member-day-table-body")?.closest("section")
    const tableHead = qs("#member-day-table-body")?.closest("table")?.querySelector("th")

    if (gridPanel) {
      gridPanel.querySelector("p").textContent = "全周期累计、峰值月份和主力模型的汇总卡片。"
    }

    if (trendPanel) {
      trendPanel.querySelector("h2").textContent = "成员月度轨迹"
    }

    if (modelPanel) {
      modelPanel.querySelector("p").textContent = "聚焦当前筛选结果中的头部成员。"
    }

    if (tablePanel) {
      tablePanel.querySelector("h2").textContent = "月级作战记录"
      tablePanel.querySelector("p").textContent = "当前焦点成员在每个月的请求与消费记录。"
    }

    if (tableHead) {
      tableHead.textContent = "月份"
    }
  } else if (activePage() === "models") {
    if (heroText) {
      heroText.textContent =
        "这里按模型维度梳理整体消耗构成、主力模型趋势和所选月份的即时分布，适合观察不同模型在团队中的真实使用占比。"
    }

    if (filterLabel) {
      filterLabel.textContent = "筛选模型"
    }

    if (filterInput) {
      filterInput.placeholder = "输入模型名称关键字"
    }

    const gridPanel = qs("#model-grid")?.closest("section")
    const trendPanel = qs("#model-trend-chart")?.closest("article")
    const monthPanel = qs("#model-day-board")?.closest("article")
    const tablePanel = qs("#model-table-body")?.closest("section")
    const logPanel = qs("#model-daily-log")?.closest("section")

    if (gridPanel) {
      gridPanel.querySelector("p").textContent = "全周期模型累计消耗、请求量和峰值趋势。"
    }

    if (trendPanel) {
      trendPanel.querySelector("p").textContent = "展示头部模型在最近周期内的月级消耗走向。"
    }

    if (monthPanel) {
      monthPanel.querySelector("h2").textContent = "所选月份模型分布"
      monthPanel.querySelector("p").textContent = "当前月份下各模型的消费分布。"
    }

    if (tablePanel) {
      tablePanel.querySelector("p").textContent = "以全周期累计结果查看每个模型的总消耗、请求数与峰值月份。"
      const peakHead = tablePanel.querySelectorAll("th")[5]
      const peakValueHead = tablePanel.querySelectorAll("th")[6]
      if (peakHead) {
        peakHead.textContent = "峰值月份"
      }
      if (peakValueHead) {
        peakValueHead.textContent = "峰值金额"
      }
    }

    if (logPanel) {
      logPanel.querySelector("h2").textContent = "每月主导模型"
      logPanel.querySelector("p").textContent = "按月份查看当月消耗最高的模型。"
    }
  } else if (activePage() === "timeline") {
    if (heroText) {
      heroText.textContent =
        "时间线页适合看整段周期内发生了什么，从首个有请求的月份开始，按每个月的总消耗、请求量和主导模型做完整的时间序列复盘。"
    }

    if (filterLabel) {
      filterLabel.textContent = "筛选时间线"
    }

    if (filterInput) {
      filterInput.placeholder = "输入月份、成员名或模型关键字"
    }

    const sidePanel = qs("#timeline-side-panel")?.closest("section")
    const gridPanel = qs("#timeline-grid")?.closest("section")
    const costPanel = qs("#timeline-cost-chart")?.closest("article")
    const requestPanel = qs("#timeline-request-chart")?.closest("article")
    const tablePanel = qs("#timeline-table-body")?.closest("section")
    const peakPanel = qs("#peak-grid")?.closest("section")
    const firstHead = qs("#timeline-table-body")?.closest("table")?.querySelector("th")

    if (sidePanel) {
      sidePanel.querySelector("p").textContent = "峰值、均值与低谷月份的快速观察。"
    }

    if (gridPanel) {
      gridPanel.querySelector("h2").textContent = "逐月节点"
      gridPanel.querySelector("p").textContent = "用卡片方式扫一遍每个月的总请求、总消耗与主导模型。"
    }

    if (costPanel) {
      costPanel.querySelector("h2").textContent = "月级消耗曲线"
      costPanel.querySelector("p").textContent = "按人民币消耗查看完整时间序列。"
    }

    if (requestPanel) {
      requestPanel.querySelector("h2").textContent = "月级请求曲线"
      requestPanel.querySelector("p").textContent = "按请求数观察活跃波峰。"
    }

    if (tablePanel) {
      tablePanel.querySelector("p").textContent = "逐月查看总消耗、请求数、主导模型和活跃成员数。"
    }

    if (peakPanel) {
      peakPanel.querySelector("h2").textContent = "峰值月份重点观察"
      peakPanel.querySelector("p").textContent = "把最值得关注的月份单独拉出来看。"
    }

    if (firstHead) {
      firstHead.textContent = "月份"
    }
  }
}

function renderHeroMarquee(payload, selectedDay, days) {
  const peakDay = pickPeakDay(days)
  const topModel = pickTopModel(selectedDay)

  qs("#hero-marquee").innerHTML = [
    {
      title: "Live Window",
      body: peakDay
        ? `${formatMonthLabel(days[0]?.date || "")} 至 ${formatMonthLabel(days.at(-1)?.date || "")}`
        : "等待同步区间",
    },
    {
      title: "Peak Month",
      body: peakDay ? `${formatMonthLabel(peakDay.date)} · ¥${Number(peakDay.primaryCost || 0).toFixed(4)}` : "尚未捕获峰值",
    },
    {
      title: "Dominant Model",
      body: `${topModel} · ${numberFormatter(selectedDay?.requests || 0)} req`,
    },
  ]
    .map(
      (item, index) => `
        <div class="hero-chip reveal-card is-visible" style="--delay: ${80 + index * 60}ms">
          <strong>${item.title}</strong>
          <span>${item.body}</span>
        </div>
      `,
    )
    .join("")
}

function renderHeroMonthFocus(payload, selectedDay, days) {
  const currency = normalizeCurrency(payload.currency)
  const balance = buildBalanceSnapshot(payload, days)
  const focus = qs("#hero-month-focus")

  if (!focus) {
    return
  }

  focus.innerHTML = selectedDay?.date
    ? `
        <div class="hero-month-topline">
          <small class="hero-month-kicker">Natural Month Focus</small>
          <span class="hero-month-badge">${formatMonthLabel(selectedDay.date)}</span>
        </div>
        <div class="hero-month-metrics">
          <div class="hero-month-primary hero-month-primary--panel">
            <span class="hero-month-label">当月累计消耗</span>
            <strong class="hero-month-value hero-month-value--cost">${currencyFormatter(currency.primarySymbol, selectedDay.primaryCost || 0)}</strong>
            <p>按自然月汇总展示当前选择月份内的全部消耗。</p>
          </div>
          <div class="hero-month-primary hero-month-primary--panel hero-month-primary--balance">
            <div class="hero-month-primary-head">
              <span class="hero-month-label">当前余额</span>
              <em class="hero-month-pill hero-month-pill--${balance.badgeTone}">${balance.badge}</em>
            </div>
            <strong class="hero-month-value hero-month-value--balance">${currencyFormatter(currency.primarySymbol, balance.remainingBalance)}</strong>
            <p>${balance.runwayText}</p>
          </div>
        </div>
        <div class="hero-month-side">
          <div class="hero-month-side-group">
            <div class="hero-month-stat">
              <span>累计请求</span>
              <strong>${numberFormatter(selectedDay.requests)}</strong>
            </div>
            <div class="hero-month-stat">
              <span>累计已用</span>
              <strong>${currencyFormatter(currency.primarySymbol, balance.usedBalance)}</strong>
            </div>
          </div>
          <div class="hero-month-side-group hero-month-side-group--range">
            <div class="hero-month-stat">
              <span>使用率</span>
              <strong>${percentFormatter(balance.utilizationRate)}</strong>
            </div>
            <div class="hero-month-stat hero-month-stat--range">
              <span>统计区间</span>
              <strong class="hero-month-stat__value hero-month-stat__value--range">${formatMonthDayLabel(selectedDay.startDate)} - ${formatMonthDayLabel(selectedDay.endDate)}</strong>
            </div>
          </div>
        </div>
      `
    : `
        <div class="hero-month-empty">
          <small class="hero-month-kicker">Natural Month Focus</small>
          <strong>等待月度数据</strong>
          <p>同步到首个有效月份后，这里会显示自然月累计消耗。</p>
        </div>
      `
}

function renderSignalDeck(payload, selectedDay, days) {
  const topPerson = selectedDay?.people?.[0]
  const peakDay = pickPeakDay(days)
  const totalPeople = payload.summary.activePeople || payload.people?.length || 0
  const avgDailyCost =
    days.length > 0
      ? Number(
          (days.reduce((sum, day) => sum + Number(day.primaryCost || 0), 0) / days.length).toFixed(4),
        )
      : 0

  qs("#signal-deck").innerHTML = [
    {
      label: "Peak Month",
      value: peakDay ? formatMonthLabel(peakDay.date) : "N/A",
      note: peakDay
        ? `¥${Number(peakDay.primaryCost || 0).toFixed(4)} / ${numberFormatter(peakDay.requests)} requests`
        : "等待峰值数据",
    },
    {
      label: "Avg Monthly Burn",
      value: `¥${avgDailyCost.toFixed(4)}`,
      note: days.length > 0 ? `按 ${numberFormatter(days.length)} 个月有效区间计算` : "暂无可计算月份",
    },
    {
      label: "Hot Operator",
      value: topPerson?.displayName || "Standby",
      note: topPerson ? `当月 ¥${Number(topPerson.primaryCost || 0).toFixed(4)}` : "当前月份没有活跃成员",
    },
    {
      label: "Tracked Members",
      value: numberFormatter(totalPeople),
      note: `${numberFormatter(payload.summary.totalRequests || 0)} total requests in ledger`,
    },
  ]
    .map(
      (item, index) => `
        <article class="signal-card interactive-card reveal-card" style="--delay: ${140 + index * 60}ms">
          <small>${item.label}</small>
          <strong>${item.value}</strong>
          <span>${item.note}</span>
        </article>
      `,
    )
    .join("")
}

function renderSummaryCards(payload, selectedDay, days) {
  const currency = normalizeCurrency(payload.currency)
  const topPerson = selectedDay?.people?.[0]

  const cards = [
    {
      label: "当前月份总消耗",
      value: currencyFormatter(currency.primarySymbol, selectedDay?.primaryCost || 0),
      caption: "按人民币直接展示",
    },
    {
      label: "当前月份请求数",
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
      label: "当月最高消耗成员",
      value: topPerson ? topPerson.displayName : "暂无",
      caption: topPerson
        ? `${currencyFormatter(currency.primarySymbol, topPerson.primaryCost)} / ${numberFormatter(topPerson.requests)} 次`
        : "等待同步",
    },
  ]

  qs("#summary-grid").innerHTML = cards
    .map(
      (card, index) => `
        <article class="stat-card interactive-card reveal-card" style="--delay: ${180 + index * 60}ms">
          <small>${card.label}</small>
          <strong class="stat-card__value">${card.value}</strong>
          <span class="stat-card__note">${card.caption}</span>
        </article>
      `,
    )
    .join("")
}

function renderSelectedDayCards(payload, selectedDay) {
  const currency = normalizeCurrency(payload.currency)

  const cards = [
    {
      label: "平台额度原值",
      value: numberFormatter(selectedDay?.rawQuota || 0),
      caption: `1 ${currency.primaryCode} = ${numberFormatter(currency.quotaPerUnit)} quota`,
      valueType: "numeric",
    },
    {
      label: "缓存读取 Tokens",
      value: numberFormatter(selectedDay?.cacheReadTokens || 0),
      caption: "来自月内汇总统计",
      valueType: "numeric",
    },
    {
      label: "缓存写入 Tokens",
      value: numberFormatter(selectedDay?.cacheWriteTokens || 0),
      caption: "聚合 cache_creation_tokens 系列字段",
      valueType: "numeric",
    },
    {
      label: "Top Models",
      value: selectedDay?.models?.length ? selectedDay.models[0].name : "暂无",
      caption: selectedDay?.models?.length ? `${numberFormatter(selectedDay.models[0].requests)} 次请求` : "等待同步",
    },
  ]

  qs("#selected-day-cards").innerHTML = cards
    .map((card, index) => {
      const valueLength = String(card.value || "").length
      const sizeClass =
        card.valueType === "numeric"
          ? valueLength >= 11
            ? "stat-card__value--dense"
            : valueLength >= 9
              ? "stat-card__value--compact"
              : ""
          : ""

      return `
        <article class="stat-card interactive-card reveal-card" style="--delay: ${220 + index * 60}ms">
          <small>${card.label}</small>
          <strong class="stat-card__value ${sizeClass}">${card.value}</strong>
          <span class="stat-card__note">${card.caption}</span>
        </article>
      `
    })
    .join("")
}

function renderCommonFrame(payload, selectedDay, days) {
  const dateInput = qs("#date-select")
  const hint = qs("#date-range-hint")

  applyMonthlyCopy()

  if (state.selectedDate && !days.some((day) => day.date === state.selectedDate)) {
    state.selectedDate = days.at(-1)?.date || null
  }

  if (dateInput) {
    dateInput.min = days[0]?.date || ""
    dateInput.max = days.at(-1)?.date || ""
    dateInput.value = state.selectedDate || ""
  }

  if (hint) {
    hint.textContent =
      days.length > 0
        ? `已按月份展示，共 ${numberFormatter(days.length)} 个月`
        : "暂无可展示的有效月份"
  }

  setText("#generated-at", dateTimeFormatter(payload.generatedAt))
  setText("#timezone", payload.source.timezone)
  setText("#scope", payload.source.scope)
  setText("#base-url", payload.source.baseUrl)
  setText("#latest-date", formatMonthLabel(days.at(-1)?.date || payload.summary.latestDate || ""))
  setText("#sync-status", selectedDay ? "Telemetry Live" : "Standby")
  highlightActiveNav()
}

function renderMembersPage(payload, selectedDay, days) {
  const members = filteredMembers(payload)
  const featuredMember = members[0] || null
  const peakDay = pickPeakDay(days)
  const memberDays = aggregateMemberDays(featuredMember)
  const memberModels = aggregateMemberModels(featuredMember).slice(0, 5)
  const latestUsageDay = latestDailyUsageDay(payload)
  const memberLookup = new Map(members.map((member) => [member.displayName, member]))
  const latestUsagePeople = sortByPrimaryCost(
    (latestUsageDay?.people || []).filter((person) => memberLookup.has(person.displayName)),
    (person) => person.primaryCost || 0,
  )

  setHTML(
    "#members-hero-marquee",
    [
      {
        title: "Tracked Members",
        body: `${numberFormatter(payload.summary.activePeople || 0)} 位活跃成员`,
      },
      {
        title: "Lead Operator",
        body: featuredMember
          ? `${featuredMember.displayName} · ¥${Number(featuredMember.totals.primaryCost || 0).toFixed(4)}`
          : "暂无匹配成员",
      },
      {
        title: "Peak Month",
        body: peakDay ? `${formatMonthLabel(peakDay.date)} · ¥${Number(peakDay.primaryCost || 0).toFixed(4)}` : "等待峰值月",
      },
    ]
      .map(
        (item) => `
          <div class="hero-chip">
            <strong>${item.title}</strong>
            <span>${item.body}</span>
          </div>
        `,
      )
      .join(""),
  )

  setText(
    "#featured-member-meta",
    latestUsageDay
      ? `${formatFullDateLabel(latestUsageDay.date)} · ${numberFormatter(latestUsagePeople.length)} 位成员有当日记录`
      : "当前没有可展示的成员当日用量",
  )

  setText(
    "#member-trend-meta",
    featuredMember
      ? `${featuredMember.displayName} · ${formatMonthLabel(memberDays[0]?.date)} 至 ${formatMonthLabel(memberDays.at(-1)?.date)}`
      : "暂无成员趋势",
  )

  setHTML(
    "#members-side-panel",
    latestUsagePeople.length
      ? latestUsagePeople
          .map((person) => {
            const linkedMember = memberLookup.get(person.displayName) || person
            const topModel = sortByPrimaryCost(person.models || [])[0]
            const tokenNames = displayTokenNames(linkedMember)

            return `
              <div class="insight-row insight-row--daily">
                <span>${person.displayName}</span>
                <strong>${currencyFormatter("¥", person.primaryCost || 0)}</strong>
                <div class="insight-inline-metrics">
                  <div class="insight-inline-metric">
                    <small>请求</small>
                    <strong>${numberFormatter(person.requests)}</strong>
                  </div>
                  <div class="insight-inline-metric">
                    <small>输入</small>
                    <strong>${numberFormatter(person.promptTokens)}</strong>
                  </div>
                  <div class="insight-inline-metric">
                    <small>输出</small>
                    <strong>${numberFormatter(person.completionTokens)}</strong>
                  </div>
                </div>
                <p>${tokenNames.join(" / ") || "未命名 Key"} · ${topModel?.name || "暂无模型"}</p>
              </div>
            `
          })
          .join("")
      : emptyChart(latestUsageDay ? "当前筛选条件下没有成员当日用量" : "今日暂无成员用量"),
  )

  setHTML(
    "#member-grid",
    members.length
      ? members
          .map((member, index) => {
            const trend = aggregateMemberDays(member)
            const peak = peakEntry(trend)
            const topModel = aggregateMemberModels(member)[0]

            return `
              <article class="stat-card interactive-card reveal-card">
                <div class="card-topline">
                  <small>${member.displayName}</small>
                  <span class="card-rank">#${String(index + 1).padStart(2, "0")}</span>
                </div>
                <strong>${currencyFormatter("¥", member.totals.primaryCost || 0)}</strong>
                <span>${numberFormatter(member.totals.requests || 0)} 次请求 · ${topModel ? topModel.name : "暂无模型"}</span>
                <div class="sparkline-wrap">${createSparkline(
                  trend.map((day) => day.primaryCost || 0),
                  "#9bbdff",
                )}</div>
                <div class="badge-row">
                  <span class="chip chip--subtle">${peak ? formatMonthLabel(peak.date) : "No peak"}</span>
                  ${displayTokenNames(member).map((tokenName) => `<span class="chip">${tokenName}</span>`).join("")}
                </div>
              </article>
            `
          })
          .join("")
      : emptyChart("当前筛选条件下没有成员卡片"),
  )

  setHTML(
    "#member-trend-chart",
    featuredMember
      ? createMetricLineChart(memberDays, {
          valueKey: "primaryCost",
          emptyMessage: "暂无成员趋势",
          stroke: "#9bbdff",
          fill: "rgba(155, 189, 255, 0.22)",
          pointColor: "#ff97c5",
          valueFormatter: (value) => Number(value || 0).toFixed(2),
        })
      : emptyChart("当前筛选条件下没有成员趋势"),
  )

  setHTML(
    "#member-model-stack",
    createStackList(memberModels, {
      labelAccessor: (model) => model.name,
      noteAccessor: (model) => `${numberFormatter(model.requests)} 次请求`,
      emptyMessage: "暂无成员模型偏好",
    }),
  )

  setHTML(
    "#member-day-table-body",
    memberDays.length
      ? [...memberDays]
          .sort((left, right) => right.date.localeCompare(left.date))
          .map(
            (day) => `
              <tr>
                <td>${formatMonthLabel(day.date)}</td>
                <td>${featuredMember.displayName}</td>
                <td>
                  <div class="token-list">
                    ${displayTokenNames({
                      displayName: featuredMember.displayName,
                      tokenNames: day.tokenNames && day.tokenNames.length ? day.tokenNames : featuredMember.tokenNames,
                    })
                      .map((tokenName) => `<span class="chip">${tokenName}</span>`)
                      .join("")}
                  </div>
                </td>
                <td>${numberFormatter(day.requests)}</td>
                <td><strong>${currencyFormatter("¥", day.primaryCost)}</strong></td>
                <td>${numberFormatter(day.promptTokens)}</td>
                <td>${numberFormatter(day.completionTokens)}</td>
                <td>
                  <div class="model-chips">
                    ${(day.models || [])
                      .map((model) => `<span class="chip chip--subtle">${model.name} · ${numberFormatter(model.requests)}</span>`)
                      .join("")}
                  </div>
                </td>
              </tr>
            `,
          )
          .join("")
      : `
          <tr>
            <td colspan="8" class="muted">当前筛选条件下没有成员月级记录。</td>
          </tr>
        `,
  )
}

function renderModelsPage(payload, selectedDay, days) {
  const models = filteredModels(days)
  const topSeries = models.slice(0, 3)
  const selectedDayModels = sortByPrimaryCost(selectedDay?.models || [])

  setHTML(
    "#models-hero-marquee",
    [
      {
        title: "Tracked Models",
        body: `${numberFormatter(models.length)} 个模型出现在本周期`,
      },
      {
        title: "Dominant Model",
        body: models[0] ? `${models[0].name} · ¥${Number(models[0].primaryCost || 0).toFixed(4)}` : "暂无模型",
      },
      {
        title: "Current Month Focus",
        body: selectedDayModels[0]
          ? `${formatMonthLabel(selectedDay?.date || "")} · ${selectedDayModels[0].name} · ${numberFormatter(selectedDayModels[0].requests)} req`
          : "所选月份暂无模型请求",
      },
    ]
      .map(
        (item) => `
          <div class="hero-chip">
            <strong>${item.title}</strong>
            <span>${item.body}</span>
          </div>
        `,
      )
      .join(""),
  )

  setText(
    "#selected-model-meta",
    models[0]
      ? `${models[0].name} 当前为全周期主导模型，共 ${numberFormatter(models[0].requests)} 次请求`
      : "当前筛选条件下没有模型",
  )

  setHTML(
    "#models-side-panel",
    models.length
      ? [
          {
            label: "头部模型",
            value: models[0].name,
            note: `累计 ¥${Number(models[0].primaryCost || 0).toFixed(4)}`,
          },
          {
            label: "峰值月份",
            value: models[0].peakDay?.date ? formatMonthLabel(models[0].peakDay.date) : "暂无",
            note: models[0].peakDay ? `单月 ¥${Number(models[0].peakDay.primaryCost || 0).toFixed(4)}` : "暂无峰值月",
          },
          {
            label: "当月模型数",
            value: numberFormatter(selectedDayModels.length),
            note: selectedDay ? `${formatMonthLabel(selectedDay.date)} 的即时快照` : "等待月份数据",
          },
        ]
          .map(
            (item) => `
              <div class="insight-row">
                <span>${item.label}</span>
                <strong>${item.value}</strong>
                <p>${item.note}</p>
              </div>
            `,
          )
          .join("")
      : emptyChart("暂无模型摘要"),
  )

  setHTML(
    "#model-grid",
    models.length
      ? models
          .map(
            (model) => `
              <article class="stat-card interactive-card reveal-card">
                <div class="card-topline">
                  <small>${model.name}</small>
                  <span class="card-rank">${numberFormatter(model.requests)} req</span>
                </div>
                <strong>${currencyFormatter("¥", model.primaryCost || 0)}</strong>
                <span>${numberFormatter(model.promptTokens)} 输入 / ${numberFormatter(model.completionTokens)} 输出</span>
                <div class="sparkline-wrap">${createSparkline(
                  model.days.map((day) => day.primaryCost || 0),
                  "#ff97c5",
                )}</div>
                <div class="badge-row">
                  <span class="chip chip--subtle">${model.peakDay?.date ? formatMonthLabel(model.peakDay.date) : "No peak"}</span>
                </div>
              </article>
            `,
          )
          .join("")
      : emptyChart("当前筛选条件下没有模型卡片"),
  )

  setHTML("#model-trend-chart", createModelTrendChart(days, topSeries))

  setHTML(
    "#model-day-board",
    createStackList(selectedDayModels, {
      labelAccessor: (model) => model.name,
      noteAccessor: (model) => `${numberFormatter(model.requests)} 次请求`,
      emptyMessage: "所选月份暂无模型分布",
    }),
  )

  setHTML(
    "#model-table-body",
    models.length
      ? models
          .map(
            (model) => `
              <tr>
                <td><strong>${model.name}</strong></td>
                <td>${numberFormatter(model.requests)}</td>
                <td>${currencyFormatter("¥", model.primaryCost)}</td>
                <td>${numberFormatter(model.promptTokens)}</td>
                <td>${numberFormatter(model.completionTokens)}</td>
                <td>${model.peakDay?.date ? formatMonthLabel(model.peakDay.date) : "-"}</td>
                <td>${model.peakDay ? currencyFormatter("¥", model.peakDay.primaryCost) : "-"}</td>
              </tr>
            `,
          )
          .join("")
      : `
          <tr>
            <td colspan="7" class="muted">当前筛选条件下没有模型表数据。</td>
          </tr>
        `,
  )

  setHTML(
    "#model-daily-log",
    [...days]
      .sort((left, right) => right.date.localeCompare(left.date))
      .map((day) => {
        const topModel = sortByPrimaryCost(day.models || [])[0]
        return `
          <article class="timeline-card interactive-card reveal-card">
            <div class="timeline-topline">
              <span class="timeline-day">${formatMonthLabel(day.date)}</span>
              <span class="chip chip--subtle">${numberFormatter(day.requests)} req</span>
            </div>
            <strong>${topModel?.name || "暂无模型"}</strong>
            <span>${topModel ? currencyFormatter("¥", topModel.primaryCost) : "0"}</span>
            <div class="timeline-tags">
              ${(day.models || []).slice(0, 3).map((model) => `<span class="chip">${model.name}</span>`).join("")}
            </div>
          </article>
        `
      })
      .join(""),
  )
}

function renderTimelinePage(payload, selectedDay, days) {
  const timelineDays = filteredTimelineDays(days)
  const peakDays = sortByPrimaryCost(timelineDays).slice(0, 3)
  const quietDay = quietEntry(timelineDays)
  const requestPeak = peakEntry(timelineDays, "requests")

  setHTML(
    "#timeline-hero-marquee",
    [
      {
        title: "Observed Months",
        body: `${numberFormatter(timelineDays.length)} 个月有效周期`,
      },
      {
        title: "Peak Burn",
        body: peakDays[0] ? `${formatMonthLabel(peakDays[0].date)} · ¥${Number(peakDays[0].primaryCost || 0).toFixed(4)}` : "暂无峰值月",
      },
      {
        title: "Peak Requests",
        body: requestPeak ? `${formatMonthLabel(requestPeak.date)} · ${numberFormatter(requestPeak.requests)} req` : "暂无请求峰值",
      },
    ]
      .map(
        (item) => `
          <div class="hero-chip">
            <strong>${item.title}</strong>
            <span>${item.body}</span>
          </div>
        `,
      )
      .join(""),
  )

  setHTML(
    "#timeline-side-panel",
    [
      {
        label: "平均月消耗",
        value: `¥${(
          timelineDays.reduce((sum, day) => sum + Number(day.primaryCost || 0), 0) / Math.max(timelineDays.length, 1)
        ).toFixed(4)}`,
        note: "按有效月份均值计算",
      },
      {
        label: "最低活跃月",
        value: quietDay?.date ? formatMonthLabel(quietDay.date) : "暂无",
        note: quietDay ? `${currencyFormatter("¥", quietDay.primaryCost)}` : "暂无静默区间",
      },
      {
        label: "当前查看月",
        value: selectedDay?.date ? formatMonthLabel(selectedDay.date) : "暂无",
        note: selectedDay ? `${numberFormatter(selectedDay.requests)} 次请求` : "等待月份选择",
      },
    ]
      .map(
        (item) => `
          <div class="insight-row">
            <span>${item.label}</span>
            <strong>${item.value}</strong>
            <p>${item.note}</p>
          </div>
        `,
      )
      .join(""),
  )

  setHTML(
    "#timeline-grid",
    timelineDays.length
      ? [...timelineDays]
          .sort((left, right) => right.date.localeCompare(left.date))
          .map((day) => {
            const topModel = sortByPrimaryCost(day.models || [])[0]
            const fill = peakDays[0]
              ? clamp((Number(day.primaryCost || 0) / Number(peakDays[0].primaryCost || 1)) * 100, 0, 100)
              : 0

            return `
              <article class="timeline-card interactive-card reveal-card">
                <div class="timeline-topline">
                  <span class="timeline-day">${formatMonthLabel(day.date)}</span>
                  <span class="chip chip--subtle">${numberFormatter(day.people?.length || 0)} 人活跃</span>
                </div>
                <strong>${currencyFormatter("¥", day.primaryCost)}</strong>
                <span>${numberFormatter(day.requests)} 次请求 · ${topModel?.name || "暂无模型"}</span>
                <div class="timeline-meter">
                  <div class="timeline-meter-fill" style="--fill:${fill}%"></div>
                </div>
              </article>
            `
          })
          .join("")
      : emptyChart("当前筛选条件下没有月度时间线节点"),
  )

  setHTML(
    "#timeline-cost-chart",
    createMetricLineChart(timelineDays, {
      valueKey: "primaryCost",
      emptyMessage: "暂无月级消耗曲线",
      stroke: "#9bbdff",
      fill: "rgba(155, 189, 255, 0.22)",
      pointColor: "#ff97c5",
      valueFormatter: (value) => Number(value || 0).toFixed(2),
    }),
  )

  setHTML(
    "#timeline-request-chart",
    createMetricLineChart(timelineDays, {
      valueKey: "requests",
      emptyMessage: "暂无月级请求曲线",
      stroke: "#ceb7ff",
      fill: "rgba(206, 183, 255, 0.22)",
      pointColor: "#ff97c5",
      valueFormatter: (value) => numberFormatter(value),
    }),
  )

  setHTML(
    "#timeline-table-body",
    timelineDays.length
      ? [...timelineDays]
          .sort((left, right) => right.date.localeCompare(left.date))
          .map((day) => {
            const topModel = sortByPrimaryCost(day.models || [])[0]
            return `
              <tr>
                <td>${formatMonthLabel(day.date)}</td>
                <td>${numberFormatter(day.requests)}</td>
                <td><strong>${currencyFormatter("¥", day.primaryCost)}</strong></td>
                <td>${numberFormatter(day.promptTokens)}</td>
                <td>${numberFormatter(day.completionTokens)}</td>
                <td>${topModel?.name || "-"}</td>
                <td>${numberFormatter(day.people?.length || 0)}</td>
              </tr>
            `
          })
          .join("")
      : `
          <tr>
            <td colspan="7" class="muted">当前筛选条件下没有月级时间线表数据。</td>
          </tr>
        `,
  )

  setHTML(
    "#peak-grid",
    peakDays.length
      ? peakDays
          .map(
            (day) => `
              <article class="signal-card interactive-card reveal-card">
                <small>${formatMonthLabel(day.date)}</small>
                <strong>${currencyFormatter("¥", day.primaryCost)}</strong>
                <span>${numberFormatter(day.requests)} 次请求 · ${
                  sortByPrimaryCost(day.models || [])[0]?.name || "暂无模型"
                }</span>
              </article>
            `,
          )
          .join("")
      : emptyChart("暂无峰值观察"),
  )
}

function renderDashboard() {
  const payload = state.payload
  const currency = normalizeCurrency(payload.currency)
  const days = displayMonths(payload)
  const selectedDay = currentMonthEntry(days)
  const dateInput = qs("#date-select")
  const hint = qs("#date-range-hint")

  applyMonthlyCopy()

  if (state.selectedDate && !days.some((day) => day.date === state.selectedDate)) {
    state.selectedDate = days.at(-1)?.date || null
  }

  dateInput.min = days[0]?.date || ""
  dateInput.max = days.at(-1)?.date || ""
  dateInput.value = state.selectedDate || ""
  hint.textContent =
    days.length > 0
      ? `已按月份展示，共 ${numberFormatter(days.length)} 个月`
      : "暂无可展示的有效月份"

  qs("#generated-at").textContent = dateTimeFormatter(payload.generatedAt)
  qs("#timezone").textContent = payload.source.timezone
  qs("#scope").textContent = payload.source.scope
  qs("#base-url").textContent = payload.source.baseUrl
  qs("#latest-date").textContent = formatMonthLabel(days.at(-1)?.date || payload.summary.latestDate || "")
  qs("#sync-status").textContent = selectedDay ? "Telemetry Live" : "Standby"

  if (selectedDay) {
    qs("#selected-date-meta").textContent = `${formatMonthLabel(selectedDay.date)} · 共 ${numberFormatter(
      selectedDay.people.length,
    )} 位成员有消费记录`
  } else {
    qs("#selected-date-meta").textContent = "暂无可用月份"
  }

  renderHeroMonthFocus(payload, selectedDay, days)
  renderHeroMarquee(payload, selectedDay, days)
  renderReminderBoard(payload, selectedDay, days)
  renderSignalDeck(payload, selectedDay, days)
  renderSummaryCards(payload, selectedDay, days)
  renderSelectedDayCards(payload, selectedDay)
  renderPeopleTable(payload, selectedDay)
  renderWarnings(payload)

  qs("#cost-trend").innerHTML = createLineChart(days)
  qs("#people-ranking").innerHTML = createBarChart(selectedDay?.people || [], currency)

  updateWebGLSceneTelemetry(selectedDay, days)

  highlightActiveNav()
  refreshMotionEffects()
}

function renderCurrentPage() {
  const payload = state.payload
  const days = displayMonths(payload)
  const selectedDay = currentMonthEntry(days)

  if (activePage() === "overview") {
    renderDashboard()
    return
  }

  renderCommonFrame(payload, selectedDay, days)
  renderWarnings(payload)

  if (activePage() === "members") {
    renderMembersPage(payload, selectedDay, days)
  } else if (activePage() === "models") {
    renderModelsPage(payload, selectedDay, days)
  } else if (activePage() === "timeline") {
    renderTimelinePage(payload, selectedDay, days)
  }

  refreshMotionEffects()
}

async function loadPayload() {
  const response = await fetch("./data/latest.json", { cache: "no-store" })
  if (!response.ok) {
    throw new Error(`Failed to load dashboard data: ${response.status}`)
  }

  state.payload = normalizePayload(await response.json())
}

function wireEvents() {
  const dateInput = qs("#date-select")
  const filterInput = qs("#person-filter")

  if (dateInput) {
    dateInput.addEventListener("change", (event) => {
      state.selectedDate = event.target.value
      renderCurrentPage()
    })
  }

  if (filterInput) {
    filterInput.addEventListener("input", (event) => {
      state.filterText = event.target.value || ""
      renderCurrentPage()
    })
  }
}

async function main() {
  await loadPayload()

  if (!state.payload.days.length) {
    updateDateOptions({
      ...state.payload,
      days: [],
    })
  } else {
    updateDateOptions(state.payload)
  }

  wireEvents()
  renderCurrentPage()
}

main().catch((error) => {
  console.error(error)

  const fallback = `
    <section class="panel">
      <div class="section-heading">
        <h2>加载失败</h2>
        <p>静态数据暂时没有成功载入。</p>
      </div>
      <article class="stat-card">
        <small>Dashboard Error</small>
        <strong>Data Load Failed</strong>
        <span>${error.message}</span>
      </article>
    </section>
  `

  const summaryGrid = qs("#summary-grid")

  if (summaryGrid) {
    summaryGrid.innerHTML = fallback
    return
  }

  const shell = qs(".page-shell")
  if (shell) {
    shell.insertAdjacentHTML("beforeend", fallback)
  }
})
