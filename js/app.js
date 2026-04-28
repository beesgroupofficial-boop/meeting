import { db } from "./firebase-config.js";
import {
  collection, doc, setDoc, getDoc, getDocs,
  query, where, onSnapshot, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ===== State =====
const state = {
  calYear: new Date().getFullYear(),
  calMonth: new Date().getMonth() + 1,
  sumYear: new Date().getFullYear(),
  sumMonth: new Date().getMonth() + 1,
  annYear: new Date().getFullYear(),
  currentStore: "bero",
  currentDate: null,
  entriesCache: {},   // "YYYY-MM-DD" -> {bero,mash,bee}
  goalsCache: {},     // "YYYY-MM" -> {bero,mash,bee,...}
  unsubscribers: [],
};

const STORES = ["bero", "mash", "bee"];
const STORE_NAMES = { bero: "ベロベロバー", mash: "MASH", bee: "Lounge Bee" };
const STORE_COLORS = { bero: "var(--accent-bero)", mash: "var(--accent-mash)", bee: "var(--accent-bee)" };
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

// ===== Helpers =====
function yen(n) {
  if (!n && n !== 0) return "¥0";
  return "¥" + Math.round(n).toLocaleString("ja-JP");
}
function fmt(n) { return n ? Math.round(n).toLocaleString("ja-JP") : "0"; }
function isWeekend(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.getDay() === 5 || d.getDay() === 6;
}
function today() { return new Date().toISOString().split("T")[0]; }
function ym(y, m) { return `${y}-${String(m).padStart(2, "0")}`; }
function pctClass(p) { return p >= 1 ? "pct-good" : p >= 0.7 ? "pct-mid" : "pct-bad"; }
function fillClass(p) { return p >= 1 ? "fill-good" : p >= 0.7 ? "fill-mid" : "fill-bad"; }

// Toast
function toast(msg, type = "success") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `toast ${type} show`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 2400);
}

// ===== Firebase =====
async function saveEntry(dateStr, data) {
  const [y, m, d] = dateStr.split("-");
  const ref = doc(db, "entries", `${y}-${m}`, "days", d);
  await setDoc(ref, { ...data, date: dateStr, updatedAt: Date.now() }, { merge: true });
  state.entriesCache[dateStr] = { ...state.entriesCache[dateStr], ...data };
}

async function loadMonthEntries(year, month) {
  const ymStr = ym(year, month);
  const snap = await getDocs(collection(db, "entries", ymStr, "days"));
  const result = {};
  snap.forEach(d => { result[d.data().date] = d.data(); });
  return result;
}

async function saveGoal(year, month, data) {
  const key = ym(year, month);
  const ref = doc(db, "goals", key);
  await setDoc(ref, { ...data, updatedAt: Date.now() }, { merge: true });
  state.goalsCache[key] = { ...state.goalsCache[key], ...data };
}

async function loadGoal(year, month) {
  const key = ym(year, month);
  if (state.goalsCache[key]) return state.goalsCache[key];
  const snap = await getDoc(doc(db, "goals", key));
  const data = snap.exists() ? snap.data() : { bero: 0, mash: 0, bee: 0, eventBero: "", eventMash: "", eventBee: "" };
  state.goalsCache[key] = data;
  return data;
}

async function loadAllGoals(year) {
  const snap = await getDocs(collection(db, "goals"));
  const result = {};
  snap.forEach(d => {
    const [y, m] = d.id.split("-");
    if (parseInt(y) === year) result[parseInt(m)] = d.data();
  });
  return result;
}

// Subscribe to month entries (real-time)
function subscribeMonth(year, month) {
  state.unsubscribers.forEach(u => u());
  state.unsubscribers = [];
  const ymStr = ym(year, month);
  const unsub = onSnapshot(collection(db, "entries", ymStr, "days"), snap => {
    snap.docChanges().forEach(change => {
      const data = change.doc.data();
      if (data.date) state.entriesCache[data.date] = data;
    });
    renderCalendar();
    updateMonthTotals();
  });
  state.unsubscribers.push(unsub);
}

// ===== Calendar =====
function renderCalendar() {
  const { calYear, calMonth } = state;
  document.getElementById("month-display").textContent =
    `${calYear}年 ${calMonth}月`;

  const firstDay = new Date(calYear, calMonth - 1, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth, 0).getDate();
  const todayStr = today();

  const grid = document.getElementById("calendar-grid");
  grid.innerHTML = "";

  // Weekday headers
  ["日","月","火","水","木","金","土"].forEach((d, i) => {
    const el = document.createElement("div");
    el.className = `cal-weekday ${i === 0 ? "sun" : i === 6 ? "sat" : ""}`;
    el.textContent = d;
    grid.appendChild(el);
  });

  // Empty cells
  for (let i = 0; i < firstDay; i++) {
    const el = document.createElement("div");
    el.className = "cal-day empty";
    grid.appendChild(el);
  }

  // Days
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calYear}-${String(calMonth).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const dow = new Date(dateStr + "T00:00:00").getDay();
    const entry = state.entriesCache[dateStr];

    const el = document.createElement("div");
    const classes = ["cal-day"];
    if (dateStr === todayStr) classes.push("today");
    if (dow === 0) classes.push("sun");
    if (dow === 6) classes.push("sat");
    el.className = classes.join(" ");

    const numEl = document.createElement("div");
    numEl.className = "day-num";
    numEl.textContent = d;
    el.appendChild(numEl);

    // Dots
    if (entry) {
      const dotsEl = document.createElement("div");
      dotsEl.className = "day-dots";
      const allEntered = STORES.every(s => entry[s]?.sales > 0);
      if (allEntered) {
        const dot = document.createElement("div");
        dot.className = "day-dot all";
        dotsEl.appendChild(dot);
      } else {
        STORES.forEach(s => {
          if (entry[s]?.sales > 0) {
            const dot = document.createElement("div");
            dot.className = `day-dot ${s}`;
            dotsEl.appendChild(dot);
          }
        });
      }
      el.appendChild(dotsEl);
    }

    el.addEventListener("click", () => openInputModal(dateStr));
    grid.appendChild(el);
  }
}

async function updateMonthTotals() {
  const { calYear, calMonth } = state;
  const goal = await loadGoal(calYear, calMonth);
  const ymStr = ym(calYear, calMonth);

  // Collect entries for this month
  const entries = Object.values(state.entriesCache).filter(e =>
    e.date && e.date.startsWith(ymStr)
  );

  const strip = document.querySelector(".month-totals-strip") || (() => {
    const s = document.createElement("div");
    s.className = "month-totals-strip";
    const cal = document.getElementById("tab-calendar");
    cal.appendChild(s);
    return s;
  })();

  strip.innerHTML = STORES.map(s => {
    const total = entries.reduce((a, e) => a + (e[s]?.sales || 0), 0);
    const g = goal[s] || 0;
    const pct = g ? (total / g * 100).toFixed(1) : 0;
    return `<div class="store-mini-card ${s}">
      <div class="store-mini-name">${STORE_NAMES[s]}</div>
      <div class="store-mini-val">${yen(total)}</div>
      <div class="store-mini-pct">${pct}%</div>
    </div>`;
  }).join("");
}

// ===== Input Modal =====
async function openInputModal(dateStr) {
  state.currentDate = dateStr;
  state.currentStore = "bero";

  const d = new Date(dateStr + "T00:00:00");
  const dow = WEEKDAYS[d.getDay()];
  document.getElementById("modal-date-label").textContent =
    `${d.getMonth()+1}/${d.getDate()}（${dow}）`;

  document.querySelectorAll(".store-tab").forEach(t => {
    t.classList.toggle("active", t.dataset.store === "bero");
  });

  await renderInputForm("bero");
  document.getElementById("input-modal").classList.add("open");
}

async function renderInputForm(store) {
  const entry = state.entriesCache[state.currentDate] || {};
  const sd = entry[store] || {};

  let html = `<div class="store-indicator ${store}"></div>`;

  if (store === "bero" || store === "bee") {
    html += `
      <div class="form-group">
        <label class="form-label">売上金額（円）</label>
        <input class="form-input" type="number" inputmode="numeric" id="f-sales" value="${sd.sales || ""}" placeholder="0">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">客数</label>
          <input class="form-input" type="number" inputmode="numeric" id="f-guests" value="${sd.guests || ""}" placeholder="0">
        </div>
        <div class="form-group">
          <label class="form-label">客単価</label>
          <input class="form-input" type="number" inputmode="numeric" id="f-unit" value="${sd.unit || ""}" placeholder="直接入力">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">組数</label>
          <input class="form-input" type="number" inputmode="numeric" id="f-groups" value="${sd.groups || ""}" placeholder="0">
        </div>
        <div class="form-group">
          <label class="form-label">組単価</label>
          <input class="form-input" type="number" inputmode="numeric" id="f-gunit" value="${sd.gunit || ""}" placeholder="直接入力">
        </div>
      </div>`;
  } else if (store === "mash") {
    const calcUnit = sd.sales && sd.guests ? Math.round(sd.sales / sd.guests) : "";
    html += `
      <div class="form-group">
        <label class="form-label">売上金額（円）</label>
        <input class="form-input" type="number" inputmode="numeric" id="f-sales" value="${sd.sales || ""}" placeholder="0">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">客数</label>
          <input class="form-input" type="number" inputmode="numeric" id="f-guests" value="${sd.guests || ""}" placeholder="0">
        </div>
        <div class="form-group">
          <label class="form-label">客単価（自動）</label>
          <input class="form-input" id="f-unit" value="${calcUnit}" placeholder="自動計算" readonly>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">新規率（%）</label>
        <input class="form-input" type="number" inputmode="decimal" id="f-newrate" value="${sd.newrate || ""}" placeholder="0.0" step="0.1">
      </div>`;
  }

  document.getElementById("modal-body").innerHTML = html;

  // MASH: auto-calc unit
  if (store === "mash") {
    const salesEl = document.getElementById("f-sales");
    const guestsEl = document.getElementById("f-guests");
    const unitEl = document.getElementById("f-unit");
    function calcUnit() {
      const s = parseFloat(salesEl.value) || 0;
      const g = parseFloat(guestsEl.value) || 0;
      unitEl.value = g > 0 ? Math.round(s / g) : "";
    }
    salesEl.addEventListener("input", calcUnit);
    guestsEl.addEventListener("input", calcUnit);
  }
}

async function saveCurrentEntry() {
  const store = state.currentStore;
  const dateStr = state.currentDate;
  const entry = state.entriesCache[dateStr] || {};

  let storeData = {};
  const sales = parseFloat(document.getElementById("f-sales")?.value) || 0;
  const guests = parseFloat(document.getElementById("f-guests")?.value) || 0;

  if (store === "bero" || store === "bee") {
    const unit = parseFloat(document.getElementById("f-unit")?.value) ||
      (guests > 0 ? Math.round(sales / guests) : 0);
    const groups = parseFloat(document.getElementById("f-groups")?.value) || 0;
    const gunit = parseFloat(document.getElementById("f-gunit")?.value) ||
      (groups > 0 ? Math.round(sales / groups) : 0);
    storeData = { sales, guests, unit, groups, gunit };
  } else if (store === "mash") {
    const unit = guests > 0 ? Math.round(sales / guests) : 0;
    const newrate = parseFloat(document.getElementById("f-newrate")?.value) || 0;
    storeData = { sales, guests, unit, newrate };
  }

  const newData = { ...entry, [store]: storeData, date: dateStr, weekend: isWeekend(dateStr) };
  await saveEntry(dateStr, newData);
  toast(`${STORE_NAMES[store]}の売上を保存しました`);
}

// ===== Summary =====
async function renderSummary() {
  const { sumYear, sumMonth } = state;
  document.getElementById("sum-month-label").textContent = `${sumYear}年 ${sumMonth}月`;
  const goal = await loadGoal(sumYear, sumMonth);
  const ymStr = ym(sumYear, sumMonth);
  const entries = Object.values(state.entriesCache).filter(e => e.date?.startsWith(ymStr));

  // Load if not cached
  let allEntries = entries;
  if (entries.length === 0) {
    const loaded = await loadMonthEntries(sumYear, sumMonth);
    Object.assign(state.entriesCache, loaded);
    allEntries = Object.values(loaded);
  }

  const todayStr = today();
  const now = new Date();
  const isCurrentMonth = sumYear === now.getFullYear() && sumMonth === now.getMonth() + 1;
  const daysInMonth = new Date(sumYear, sumMonth, 0).getDate();
  const cutDay = isCurrentMonth ? now.getDate() : daysInMonth;

  // Remaining business days
  let remWkday = 0, remWkend = 0;
  for (let d = cutDay + 1; d <= daysInMonth; d++) {
    const dow = new Date(sumYear, sumMonth - 1, d).getDay();
    if (dow === 5 || dow === 6) remWkend++; else remWkday++;
  }

  let html = "";
  for (const store of STORES) {
    const g = goal[store] || 0;
    const total = allEntries.reduce((a, e) => a + (e[store]?.sales || 0), 0);
    const pct = g > 0 ? total / g : 0;
    const remaining = Math.max(0, g - total);

    const wkdayE = allEntries.filter(e => !e.weekend);
    const wkendE = allEntries.filter(e => e.weekend);
    const wkdayAvg = wkdayE.length ? wkdayE.reduce((a, e) => a + (e[store]?.sales || 0), 0) / wkdayE.length : 0;
    const wkendAvg = wkendE.length ? wkendE.reduce((a, e) => a + (e[store]?.sales || 0), 0) / wkendE.length : 0;

    const totalGuests = allEntries.reduce((a, e) => a + (e[store]?.guests || 0), 0);
    const totalGroups = allEntries.reduce((a, e) => a + (e[store]?.groups || 0), 0);
    const avgUnit = totalGuests > 0 ? total / totalGuests : 0;
    const avgGUnit = totalGroups > 0 ? total / totalGroups : 0;
    const newrateAvg = store === "mash" && allEntries.length
      ? allEntries.reduce((a, e) => a + (e[store]?.newrate || 0), 0) / allEntries.length : null;

    const wkdayTgt = remWkday > 0 ? remaining / remWkday : 0;
    const wkendTgt = remWkend > 0 ? remaining / remWkend : 0;

    const pc = pctClass(pct);
    const fc = fillClass(pct);

    html += `<div class="summary-store-card">
      <div class="store-card-header">
        <span class="store-card-name" style="color:${STORE_COLORS[store]}">${STORE_NAMES[store]}</span>
        <span class="store-card-pct ${pc}">${(pct * 100).toFixed(1)}%</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill ${fc}" style="width:${Math.min(100, pct*100)}%"></div>
      </div>
      <div class="store-card-metrics">
        <div class="metric-cell">
          <span class="metric-label">総売上</span>
          <span class="metric-value">${yen(total)}</span>
        </div>
        <div class="metric-cell">
          <span class="metric-label">目標</span>
          <span class="metric-value">${yen(g)}</span>
        </div>
        <div class="metric-cell">
          <span class="metric-label">残り</span>
          <span class="metric-value">${yen(remaining)}</span>
        </div>
        <div class="metric-cell">
          <span class="metric-label">平日平均</span>
          <span class="metric-value">${yen(wkdayAvg)}</span>
        </div>
        <div class="metric-cell">
          <span class="metric-label">週末平均</span>
          <span class="metric-value">${yen(wkendAvg)}</span>
        </div>
        <div class="metric-cell">
          <span class="metric-label">客単価</span>
          <span class="metric-value">${yen(avgUnit)}</span>
        </div>
      </div>
      <div class="store-card-footer">
        <div class="footer-stat">
          <span class="footer-label">平日目標（残り${remWkday}日）</span>
          <span class="footer-value">${yen(wkdayTgt)}/日</span>
        </div>
        <div class="footer-stat">
          <span class="footer-label">週末目標（残り${remWkend}日）</span>
          <span class="footer-value">${yen(wkendTgt)}/日</span>
        </div>
        ${store !== "mash" ? `
        <div class="footer-stat">
          <span class="footer-label">組単価</span>
          <span class="footer-value">${yen(avgGUnit)}</span>
        </div>` : `
        <div class="footer-stat">
          <span class="footer-label">新規率</span>
          <span class="footer-value">${newrateAvg !== null ? newrateAvg.toFixed(1) + "%" : "-"}</span>
        </div>`}
        <div class="footer-stat">
          <span class="footer-label">営業日数</span>
          <span class="footer-value">${allEntries.length}日</span>
        </div>
      </div>
    </div>`;
  }

  // Event info
  const events = [
    { store: "bero", event: goal.eventBero },
    { store: "mash", event: goal.eventMash },
    { store: "bee", event: goal.eventBee },
  ].filter(e => e.event);

  if (events.length) {
    html += `<div class="summary-store-card" style="margin-top:8px;">
      <div class="store-card-header"><span class="store-card-name">イベント</span></div>
      ${events.map(e => `<div class="metric-cell" style="background:var(--bg2);">
        <span class="metric-label" style="color:${STORE_COLORS[e.store]}">${STORE_NAMES[e.store]}</span>
        <span class="metric-value" style="font-size:12px;font-weight:400;">${e.event}</span>
      </div>`).join("")}
    </div>`;
  }

  document.getElementById("summary-content").innerHTML = html;
}

// ===== Annual =====
async function renderAnnual() {
  const { annYear } = state;
  document.getElementById("ann-year-label").textContent = `${annYear}年`;
  const allGoals = await loadAllGoals(annYear);

  let html = `<div class="annual-scroll"><table class="annual-table">`;

  for (const store of STORES) {
    html += `<thead><tr>
      <th colspan="4" class="store-head" style="color:${STORE_COLORS[store]};text-align:left;">${STORE_NAMES[store]}</th>
    </tr>
    <tr>
      <th style="text-align:left;">月</th>
      <th>目標</th><th>実績</th><th>達成率</th>
    </tr></thead><tbody>`;

    let totalGoal = 0, totalSales = 0;
    for (let m = 1; m <= 12; m++) {
      const g = (allGoals[m] || {})[store] || 0;
      const ymStr = ym(annYear, m);
      const entries = await loadMonthEntries(annYear, m);
      const total = Object.values(entries).reduce((a, e) => a + (e[store]?.sales || 0), 0);
      const pct = g > 0 && total > 0 ? total / g : 0;
      totalGoal += g; totalSales += total;

      const cls = pct >= 1 ? "achieved" : pct >= 0.7 ? "warn" : pct > 0 ? "low" : "";
      html += `<tr>
        <td>${m}月</td>
        <td>${g ? fmt(g) : "-"}</td>
        <td>${total ? yen(total) : "-"}</td>
        <td class="${cls}">${pct > 0 ? (pct*100).toFixed(1)+"%" : "-"}</td>
      </tr>`;
    }

    const totalPct = totalGoal > 0 && totalSales > 0 ? totalSales / totalGoal : 0;
    html += `<tr>
      <td>合計</td>
      <td>${fmt(totalGoal)}</td>
      <td>${yen(totalSales)}</td>
      <td class="${totalPct >= 1 ? "achieved" : "low"}">${totalPct > 0 ? (totalPct*100).toFixed(1)+"%" : "-"}</td>
    </tr></tbody>`;
  }

  html += `</table></div>`;
  document.getElementById("annual-content").innerHTML = html;
}

// ===== Goal Modal =====
let goalModalYear, goalModalMonth;

async function openGoalModal() {
  goalModalYear = state.calYear;
  goalModalMonth = state.calMonth;
  await renderGoalModal();
  document.getElementById("goal-modal").classList.add("open");
}

async function renderGoalModal() {
  const goal = await loadGoal(goalModalYear, goalModalMonth);

  const body = document.getElementById("goal-modal-body");
  body.innerHTML = `
    <div class="goal-month-nav">
      <button class="nav-arrow" id="gm-prev">&#8249;</button>
      <span id="gm-label">${goalModalYear}年 ${goalModalMonth}月</span>
      <button class="nav-arrow" id="gm-next">&#8250;</button>
    </div>
    ${STORES.map(s => `
    <div class="goal-store-block">
      <div class="goal-store-label ${s}">${STORE_NAMES[s]}</div>
      <div class="form-group">
        <label class="form-label">月間目標売上（円）</label>
        <input class="form-input" type="number" inputmode="numeric" id="g-${s}" value="${goal[s] || ""}" placeholder="0">
      </div>
      <div class="form-group">
        <label class="form-label">イベント内容</label>
        <input class="form-input" type="text" id="ge-${s}" value="${goal["event" + s.charAt(0).toUpperCase() + s.slice(1)] || ""}" placeholder="例：団体割">
      </div>
    </div>`).join("")}`;

  document.getElementById("gm-prev").onclick = async () => {
    goalModalMonth--;
    if (goalModalMonth < 1) { goalModalMonth = 12; goalModalYear--; }
    await renderGoalModal();
  };
  document.getElementById("gm-next").onclick = async () => {
    goalModalMonth++;
    if (goalModalMonth > 12) { goalModalMonth = 1; goalModalYear++; }
    await renderGoalModal();
  };
}

async function saveGoalData() {
  const data = {
    bero: parseFloat(document.getElementById("g-bero")?.value) || 0,
    mash: parseFloat(document.getElementById("g-mash")?.value) || 0,
    bee: parseFloat(document.getElementById("g-bee")?.value) || 0,
    eventBero: document.getElementById("ge-bero")?.value || "",
    eventMash: document.getElementById("ge-mash")?.value || "",
    eventBee: document.getElementById("ge-bee")?.value || "",
  };
  await saveGoal(goalModalYear, goalModalMonth, data);
  toast(`${goalModalYear}年${goalModalMonth}月の目標を保存しました`);
  document.getElementById("goal-modal").classList.remove("open");
  updateMonthTotals();
}

// ===== Excel Export (via Claude) =====
async function exportExcel() {
  toast("データを準備中...", "success");
  const year = state.calYear;
  const allGoals = await loadAllGoals(year);
  const allData = {};
  for (let m = 1; m <= 12; m++) {
    const entries = await loadMonthEntries(year, m);
    allData[m] = { entries: Object.values(entries), goals: allGoals[m] || {} };
  }
  const payload = JSON.stringify({ year, currentMonth: state.calMonth, data: allData });

  // Store in local storage for Claude
  try {
    await window.storage.set("export_payload", payload);
    if (typeof sendPrompt === "function") {
      sendPrompt(`売上データのExcelファイルを生成してください。ストレージキー "export_payload" にJSONデータが保存されています。`);
    } else {
      // Fallback: download as JSON
      const blob = new Blob([payload], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `sales_${year}.json`; a.click();
    }
  } catch(e) {
    console.error(e);
    toast("エクスポート失敗", "error");
  }
}

// ===== Event Listeners =====
function setupEvents() {
  // Tabs
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));
      btn.classList.add("active");
      const tab = document.getElementById(`tab-${btn.dataset.tab}`);
      tab.classList.add("active");
      if (btn.dataset.tab === "summary") renderSummary();
      if (btn.dataset.tab === "annual") renderAnnual();
    });
  });

  // Calendar nav
  document.getElementById("prev-month").addEventListener("click", () => {
    state.calMonth--;
    if (state.calMonth < 1) { state.calMonth = 12; state.calYear--; }
    subscribeMonth(state.calYear, state.calMonth);
    updateMonthTotals();
  });
  document.getElementById("next-month").addEventListener("click", () => {
    state.calMonth++;
    if (state.calMonth > 12) { state.calMonth = 1; state.calYear++; }
    subscribeMonth(state.calYear, state.calMonth);
    updateMonthTotals();
  });

  // Summary nav
  document.getElementById("sum-prev").addEventListener("click", () => {
    state.sumMonth--;
    if (state.sumMonth < 1) { state.sumMonth = 12; state.sumYear--; }
    renderSummary();
  });
  document.getElementById("sum-next").addEventListener("click", () => {
    state.sumMonth++;
    if (state.sumMonth > 12) { state.sumMonth = 1; state.sumYear++; }
    renderSummary();
  });

  // Annual nav
  document.getElementById("ann-prev").addEventListener("click", () => { state.annYear--; renderAnnual(); });
  document.getElementById("ann-next").addEventListener("click", () => { state.annYear++; renderAnnual(); });

  // Store tabs in modal
  document.querySelectorAll(".store-tab").forEach(tab => {
    tab.addEventListener("click", async () => {
      await saveCurrentEntry();
      document.querySelectorAll(".store-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      state.currentStore = tab.dataset.store;
      await renderInputForm(tab.dataset.store);
    });
  });

  // Save entry
  document.getElementById("save-entry-btn").addEventListener("click", async () => {
    await saveCurrentEntry();
    document.getElementById("input-modal").classList.remove("open");
  });

  // Close modals
  document.getElementById("close-input-modal").addEventListener("click", () => {
    document.getElementById("input-modal").classList.remove("open");
  });
  document.getElementById("close-goal-modal").addEventListener("click", () => {
    document.getElementById("goal-modal").classList.remove("open");
  });
  document.querySelectorAll(".modal-overlay").forEach(overlay => {
    overlay.addEventListener("click", e => {
      if (e.target === overlay) overlay.classList.remove("open");
    });
  });

  // Goal & Export buttons
  document.getElementById("goal-btn").addEventListener("click", openGoalModal);
  document.getElementById("export-btn").addEventListener("click", exportExcel);
  document.getElementById("save-goal-btn").addEventListener("click", saveGoalData);
}

// ===== Init =====
async function init() {
  setupEvents();
  subscribeMonth(state.calYear, state.calMonth);
  await updateMonthTotals();

  document.getElementById("loading-screen").style.display = "none";
  document.getElementById("main-app").style.display = "flex";
}

init().catch(err => {
  console.error("Init error:", err);
  document.getElementById("loading-screen").innerHTML =
    `<div style="color:#f87171;text-align:center;padding:20px;">
      <p>接続エラー</p>
      <p style="font-size:12px;margin-top:8px;">firebase-config.js の設定を確認してください</p>
    </div>`;
});
