import { db } from "./firebase-config.js";
import {
  collection, doc, setDoc, getDoc, getDocs, onSnapshot
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
  entriesCache: {},
  goalsCache: {},
  unsubscribers: [],
};

const STORES = ["bero", "mash", "bee"];
const STORE_NAMES = { bero: "ベロベロバー", mash: "MASH", bee: "Lounge Bee" };
const STORE_COLORS = { bero: "var(--accent-bero)", mash: "var(--accent-mash)", bee: "var(--accent-bee)" };
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

// ===== 日本の祝日 (2024-2027) =====
const HOLIDAYS = new Set([
  "2024-01-01","2024-01-08","2024-02-11","2024-02-12","2024-02-23",
  "2024-03-20","2024-04-29","2024-05-03","2024-05-04","2024-05-05","2024-05-06",
  "2024-07-15","2024-08-11","2024-08-12","2024-09-16","2024-09-22","2024-09-23",
  "2024-10-14","2024-11-03","2024-11-04","2024-11-23",
  "2025-01-01","2025-01-13","2025-02-11","2025-02-23","2025-02-24",
  "2025-03-20","2025-04-29","2025-05-03","2025-05-04","2025-05-05","2025-05-06",
  "2025-07-21","2025-08-11","2025-09-15","2025-09-22","2025-09-23",
  "2025-10-13","2025-11-03","2025-11-23","2025-11-24",
  "2026-01-01","2026-01-12","2026-02-11","2026-02-23",
  "2026-03-20","2026-04-29","2026-05-03","2026-05-04","2026-05-05","2026-05-06",
  "2026-07-20","2026-08-11","2026-09-21","2026-09-22","2026-09-23",
  "2026-10-12","2026-11-03","2026-11-23",
  "2027-01-01","2027-01-11","2027-02-11","2027-02-23",
  "2027-03-21","2027-03-22","2027-04-29","2027-05-03","2027-05-04","2027-05-05",
  "2027-07-19","2027-08-11","2027-09-20","2027-09-23",
  "2027-10-11","2027-11-03","2027-11-23",
]);

function isHoliday(ds) { return HOLIDAYS.has(ds); }

function dateStr(year, month, day) {
  return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
}

function buildHolidayGroups(year, month) {
  const days = new Date(year, month, 0).getDate();
  const allDays = [];
  for (let d = -2; d <= days + 2; d++) {
    const dt = new Date(year, month - 1, d);
    const ds = dt.toISOString().split("T")[0];
    const dow = dt.getDay();
    if (isHoliday(ds) || dow === 0 || dow === 6) allDays.push(ds);
  }
  const groups = [];
  for (const ds of allDays) {
    const d = new Date(ds + "T00:00:00");
    if (groups.length === 0) { groups.push([ds]); continue; }
    const last = groups[groups.length - 1];
    const lastD = new Date(last[last.length - 1] + "T00:00:00");
    if ((d - lastD) / 86400000 === 1) last.push(ds);
    else groups.push([ds]);
  }
  return groups;
}

function classifyDay(ds) {
  const dt = new Date(ds + "T00:00:00");
  const dow = dt.getDay();
  if (dow === 5 || dow === 6) return "weekend";
  const nextDt = new Date(dt); nextDt.setDate(nextDt.getDate() + 1);
  const nextDs = nextDt.toISOString().split("T")[0];
  if (isHoliday(nextDs) || nextDt.getDay() === 6) return "weekend";
  if (!isHoliday(ds)) return "weekday";
  const year = dt.getFullYear(), month = dt.getMonth() + 1;
  const groups = buildHolidayGroups(year, month);
  for (const group of groups) {
    if (!group.includes(ds)) continue;
    if (group.length === 1) return "weekday";
    return group[group.length - 1] === ds ? "weekday" : "weekend";
  }
  return "weekday";
}

// ===== Helpers =====
function yen(n) {
  if (!n && n !== 0) return "¥0";
  return "¥" + Math.round(n).toLocaleString("ja-JP");
}
function fmt(n) { return n ? Math.round(n).toLocaleString("ja-JP") : "0"; }
function today() { return new Date().toISOString().split("T")[0]; }
function ym(y, m) { return `${y}-${String(m).padStart(2,"0")}`; }
function pctClass(p) { return p >= 1 ? "pct-good" : p >= 0.7 ? "pct-mid" : "pct-bad"; }
function fillClass(p) { return p >= 1 ? "fill-good" : p >= 0.7 ? "fill-mid" : "fill-bad"; }

function toast(msg, type = "success") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `toast ${type} show`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 2400);
}

// ===== Firebase =====
async function saveEntry(ds, data) {
  const [y, m, d] = ds.split("-");
  const ref = doc(db, "entries", `${y}-${m}`, "days", d);
  await setDoc(ref, { ...data, date: ds, updatedAt: Date.now() }, { merge: true });
  state.entriesCache[ds] = { ...state.entriesCache[ds], ...data };
}

async function loadMonthEntries(year, month) {
  const ymStr = ym(year, month);
  try {
    const snap = await getDocs(collection(db, "entries", ymStr, "days"));
    const result = {};
    snap.forEach(d => { result[d.data().date] = d.data(); });
    return result;
  } catch(e) {
    console.error("loadMonthEntries error:", e);
    return {};
  }
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
  try {
    const snap = await getDoc(doc(db, "goals", key));
    const data = snap.exists() ? snap.data() : { bero: 0, mash: 0, bee: 0, eventBero: "", eventMash: "", eventBee: "" };
    state.goalsCache[key] = data;
    return data;
  } catch(e) {
    console.error("loadGoal error:", e);
    return { bero: 0, mash: 0, bee: 0, eventBero: "", eventMash: "", eventBee: "" };
  }
}

async function loadAllGoals(year) {
  try {
    const snap = await getDocs(collection(db, "goals"));
    const result = {};
    snap.forEach(d => {
      const parts = d.id.split("-");
      if (parts.length === 2 && parseInt(parts[0]) === year) {
        result[parseInt(parts[1])] = d.data();
      }
    });
    return result;
  } catch(e) {
    console.error("loadAllGoals error:", e);
    return {};
  }
}

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

function remainingDays(year, month, cutDay) {
  const days = new Date(year, month, 0).getDate();
  let remWkday = 0, remWkend = 0;
  for (let d = cutDay; d <= days; d++) {
    const ds = dateStr(year, month, d);
    if (classifyDay(ds) === "weekend") remWkend++;
    else remWkday++;
  }
  return { remWkday, remWkend };
}

function isWeekend(entry) {
  return (entry.dayType || (entry.weekend ? "weekend" : "weekday")) === "weekend";
}

// ===== Calendar =====
function renderCalendar() {
  const { calYear, calMonth } = state;
  document.getElementById("month-display").textContent = `${calYear}年 ${calMonth}月`;
  const firstDay = new Date(calYear, calMonth - 1, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth, 0).getDate();
  const todayStr = today();
  const grid = document.getElementById("calendar-grid");
  grid.innerHTML = "";

  ["日","月","火","水","木","金","土"].forEach((d, i) => {
    const el = document.createElement("div");
    el.className = `cal-weekday ${i===0?"sun":i===6?"sat":""}`;
    el.textContent = d;
    grid.appendChild(el);
  });

  for (let i = 0; i < firstDay; i++) {
    const el = document.createElement("div");
    el.className = "cal-day empty";
    grid.appendChild(el);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const ds = dateStr(calYear, calMonth, d);
    const dow = new Date(ds + "T00:00:00").getDay();
    const entry = state.entriesCache[ds];
    const hol = isHoliday(ds);
    const dayType = classifyDay(ds);

    const el = document.createElement("div");
    const classes = ["cal-day"];
    if (ds === todayStr) classes.push("today");
    if (dow === 0 || (hol && dow !== 6 && dow !== 5)) classes.push("sun");
    if (dow === 6) classes.push("sat");
    el.className = classes.join(" ");
    el.style.position = "relative";

    if (hol) {
      const mark = document.createElement("div");
      mark.style.cssText = "position:absolute;top:3px;right:4px;width:4px;height:4px;border-radius:50%;background:#d93025;opacity:0.7;";
      el.appendChild(mark);
    }
    if (dayType === "weekend" && ds !== todayStr) {
      el.style.background = "rgba(37,118,212,0.04)";
    }

    const numEl = document.createElement("div");
    numEl.className = "day-num";
    numEl.textContent = d;
    if (dow === 5) numEl.style.color = "#2576d4";
    el.appendChild(numEl);

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

    el.addEventListener("click", () => openInputModal(ds));
    grid.appendChild(el);
  }
}

async function updateMonthTotals() {
  const { calYear, calMonth } = state;
  const goal = await loadGoal(calYear, calMonth);
  const ymStr = ym(calYear, calMonth);
  const entries = Object.values(state.entriesCache).filter(e => e.date?.startsWith(ymStr));

  let strip = document.querySelector(".month-totals-strip");
  if (!strip) {
    strip = document.createElement("div");
    strip.className = "month-totals-strip";
    document.getElementById("tab-calendar").appendChild(strip);
  }

  const grandTotal = STORES.reduce((a, s) => a + entries.reduce((b, e) => b + (e[s]?.sales || 0), 0), 0);
  const grandGoal = STORES.reduce((a, s) => a + (goal[s] || 0), 0);
  const grandPct = grandGoal ? (grandTotal / grandGoal * 100).toFixed(1) : 0;

  const storeCards = STORES.map(s => {
    const total = entries.reduce((a, e) => a + (e[s]?.sales || 0), 0);
    const g = goal[s] || 0;
    const pct = g ? (total / g * 100).toFixed(1) : 0;
    return `<div class="store-mini-card ${s}">
      <div class="store-mini-name">${STORE_NAMES[s]}</div>
      <div class="store-mini-val">${yen(total)}</div>
      <div class="store-mini-pct">${pct}%</div>
    </div>`;
  }).join("");

  strip.innerHTML = `
    <div class="total-grand-card">
      <div class="store-mini-name">3店舗合計</div>
      <div class="store-mini-val" style="font-size:15px;">${yen(grandTotal)}</div>
      <div class="store-mini-pct">${grandPct}%</div>
    </div>
    ${storeCards}`;
}

// ===== Input Modal =====
async function openInputModal(ds) {
  state.currentDate = ds;
  state.currentStore = "bero";
  const dt = new Date(ds + "T00:00:00");
  const dow = WEEKDAYS[dt.getDay()];
  const holMark = isHoliday(ds) ? "（祝）" : "";
  const typeMark = classifyDay(ds) === "weekend" ? " 🔵週末" : " ⚪平日";
  document.getElementById("modal-date-label").textContent =
    `${dt.getMonth()+1}/${dt.getDate()}（${dow}）${holMark}${typeMark}`;
  document.querySelectorAll(".store-tab").forEach(t => {
    t.classList.toggle("active", t.dataset.store === "bero");
  });
  await renderInputForm("bero");
  document.getElementById("input-modal").classList.add("open");
}

async function renderInputForm(store) {
  const entry = state.entriesCache[state.currentDate] || {};
  const sd = entry[store] || {};
  const calcUnit = sd.sales && sd.guests ? Math.round(sd.sales / sd.guests) : "";
  const calcGUnit = sd.sales && sd.groups ? Math.round(sd.sales / sd.groups) : "";

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
          <label class="form-label">客単価（自動）</label>
          <input class="form-input" id="f-unit" value="${calcUnit}" placeholder="自動計算" readonly>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">組数</label>
          <input class="form-input" type="number" inputmode="numeric" id="f-groups" value="${sd.groups || ""}" placeholder="0">
        </div>
        <div class="form-group">
          <label class="form-label">組単価（自動）</label>
          <input class="form-input" id="f-gunit" value="${calcGUnit}" placeholder="自動計算" readonly>
        </div>
      </div>`;
  } else if (store === "mash") {
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
      </div>`;
  }

  document.getElementById("modal-body").innerHTML = html;

  // 全店舗: 売上・客数 → 客単価自動計算
  const salesEl = document.getElementById("f-sales");
  const guestsEl = document.getElementById("f-guests");
  const unitEl = document.getElementById("f-unit");
  if (salesEl && guestsEl && unitEl) {
    const calcU = () => {
      const s = parseFloat(salesEl.value) || 0;
      const g = parseFloat(guestsEl.value) || 0;
      unitEl.value = g > 0 ? Math.round(s / g) : "";
    };
    salesEl.addEventListener("input", calcU);
    guestsEl.addEventListener("input", calcU);
  }
  // bero/bee: 売上・組数 → 組単価自動計算
  if (store !== "mash") {
    const groupsEl = document.getElementById("f-groups");
    const gunitEl = document.getElementById("f-gunit");
    if (salesEl && groupsEl && gunitEl) {
      const calcG = () => {
        const s = parseFloat(salesEl.value) || 0;
        const g = parseFloat(groupsEl.value) || 0;
        gunitEl.value = g > 0 ? Math.round(s / g) : "";
      };
      salesEl.addEventListener("input", calcG);
      groupsEl.addEventListener("input", calcG);
    }
  }
}

async function saveCurrentEntry() {
  const store = state.currentStore;
  const ds = state.currentDate;
  const entry = state.entriesCache[ds] || {};
  const sales = parseFloat(document.getElementById("f-sales")?.value) || 0;
  const guests = parseFloat(document.getElementById("f-guests")?.value) || 0;
  let storeData = {};

  if (store === "bero" || store === "bee") {
    const unit = guests > 0 ? Math.round(sales / guests) : 0;
    const groups = parseFloat(document.getElementById("f-groups")?.value) || 0;
    const gunit = groups > 0 ? Math.round(sales / groups) : 0;
    storeData = { sales, guests, unit, groups, gunit };
  } else if (store === "mash") {
    const unit = guests > 0 ? Math.round(sales / guests) : 0;
    storeData = { sales, guests, unit };
  }

  const dayType = classifyDay(ds);
  const newData = { ...entry, [store]: storeData, date: ds, dayType };
  await saveEntry(ds, newData);
  toast(`${STORE_NAMES[store]}の売上を保存しました`);
}

// ===== Summary =====
async function renderSummary() {
  const { sumYear, sumMonth } = state;
  document.getElementById("sum-month-label").textContent = `${sumYear}年 ${sumMonth}月`;
  const goal = await loadGoal(sumYear, sumMonth);
  const ymStr = ym(sumYear, sumMonth);

  let allEntries = Object.values(state.entriesCache).filter(e => e.date?.startsWith(ymStr));
  if (allEntries.length === 0) {
    const loaded = await loadMonthEntries(sumYear, sumMonth);
    Object.assign(state.entriesCache, loaded);
    allEntries = Object.values(loaded);
  }

  const now = new Date();
  const isCurrentMonth = sumYear === now.getFullYear() && sumMonth === now.getMonth() + 1;
  const todayStr = today();
  const todayEntered = isCurrentMonth && allEntries.some(e =>
    e.date === todayStr && STORES.some(s => (e[s]?.sales || 0) > 0));
  const cutDay = isCurrentMonth
    ? (todayEntered ? now.getDate() + 1 : now.getDate())
    : new Date(sumYear, sumMonth, 0).getDate() + 1;
  const { remWkday, remWkend } = remainingDays(sumYear, sumMonth, cutDay);

  let html = "";
  for (const store of STORES) {
    const g = goal[store] || 0;
    const total = allEntries.reduce((a, e) => a + (e[store]?.sales || 0), 0);
    const pct = g > 0 ? total / g : 0;
    const remaining = Math.max(0, g - total);

    const wkdayEntries = allEntries.filter(e => isWeekend(e) === false);
    const wkendEntries = allEntries.filter(e => isWeekend(e) === true);
    const wkdaySales = wkdayEntries.filter(e => (e[store]?.sales || 0) > 0).map(e => e[store].sales);
    const wkendSales = wkendEntries.filter(e => (e[store]?.sales || 0) > 0).map(e => e[store].sales);
    const wkdayAvg = wkdaySales.length ? wkdaySales.reduce((a,b)=>a+b,0)/wkdaySales.length : 0;
    const wkendAvg = wkendSales.length ? wkendSales.reduce((a,b)=>a+b,0)/wkendSales.length : 0;

    const totalGuests = allEntries.reduce((a, e) => a + (e[store]?.guests || 0), 0);
    const totalGroups = allEntries.reduce((a, e) => a + (e[store]?.groups || 0), 0);
    const totalSales = allEntries.reduce((a, e) => a + (e[store]?.sales || 0), 0);
    const avgUnit = totalGuests > 0 ? Math.round(totalSales / totalGuests) : 0;
    const avgGUnit = totalGroups > 0 ? Math.round(totalSales / totalGroups) : 0;

    // 比率按分で目標計算
    let wkdayTgt = 0, wkendTgt = 0;
    const hasWd = wkdayAvg > 0 && remWkday > 0;
    const hasWe = wkendAvg > 0 && remWkend > 0;
    if (hasWd && hasWe) {
      const wWd = wkdayAvg * remWkday, wWe = wkendAvg * remWkend;
      wkdayTgt = (remaining * wWd / (wWd + wWe)) / remWkday;
      wkendTgt = (remaining * wWe / (wWd + wWe)) / remWkend;
    } else if (hasWd) {
      wkdayTgt = remaining / remWkday;
    } else if (hasWe) {
      wkendTgt = remaining / remWkend;
    } else if (remWkday + remWkend > 0) {
      const per = remaining / (remWkday + remWkend);
      wkdayTgt = remWkday > 0 ? per : 0;
      wkendTgt = remWkend > 0 ? per : 0;
    }

    const pc = pctClass(pct), fc = fillClass(pct);
    html += `<div class="summary-store-card">
      <div class="store-card-header">
        <span class="store-card-name" style="color:${STORE_COLORS[store]}">${STORE_NAMES[store]}</span>
        <span class="store-card-pct ${pc}">${(pct*100).toFixed(1)}%</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill ${fc}" style="width:${Math.min(100,pct*100)}%"></div>
      </div>
      <div class="store-card-metrics">
        <div class="metric-cell"><span class="metric-label">総売上</span><span class="metric-value">${yen(total)}</span></div>
        <div class="metric-cell"><span class="metric-label">目標</span><span class="metric-value">${yen(g)}</span></div>
        <div class="metric-cell"><span class="metric-label">残り</span><span class="metric-value">${yen(remaining)}</span></div>
        <div class="metric-cell"><span class="metric-label">平日平均（${wkdaySales.length}日）</span><span class="metric-value">${yen(wkdayAvg)}</span></div>
        <div class="metric-cell"><span class="metric-label">週末平均（${wkendSales.length}日）</span><span class="metric-value">${yen(wkendAvg)}</span></div>
        <div class="metric-cell"><span class="metric-label">来客数</span><span class="metric-value">${fmt(totalGuests)}人</span></div>
        <div class="metric-cell"><span class="metric-label">客単価</span><span class="metric-value">${yen(avgUnit)}</span></div>
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
        <div class="footer-stat">
          <span class="footer-label">組単価</span>
          <span class="footer-value">${store !== "mash" ? yen(avgGUnit) : "-"}</span>
        </div>
        <div class="footer-stat">
          <span class="footer-label">営業日数</span>
          <span class="footer-value">平日${wkdaySales.length}日・週末${wkendSales.length}日</span>
        </div>
      </div>
    </div>`;
  }

  const events = [
    { store:"bero", event: goal.eventBero },
    { store:"mash", event: goal.eventMash },
    { store:"bee",  event: goal.eventBee },
  ].filter(e => e.event);
  if (events.length) {
    html += `<div class="summary-store-card">
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
  document.getElementById("annual-content").innerHTML =
    `<div style="text-align:center;padding:40px;color:var(--text2);">読み込み中...</div>`;

  try {
    const allGoals = await loadAllGoals(annYear);
    let html = `<div class="annual-scroll"><table class="annual-table">`;

    for (const store of STORES) {
      html += `<thead><tr>
        <th colspan="4" class="store-head" style="color:${STORE_COLORS[store]};text-align:left;padding-left:6px;">${STORE_NAMES[store]}</th>
      </tr><tr>
        <th style="text-align:left;">月</th>
        <th>目標</th><th>実績</th><th>達成率</th>
      </tr></thead><tbody>`;

      let totalGoal = 0, totalSales = 0;
      for (let m = 1; m <= 12; m++) {
        const g = (allGoals[m] || {})[store] || 0;
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
      const tp = totalGoal > 0 && totalSales > 0 ? totalSales / totalGoal : 0;
      html += `<tr>
        <td>合計</td><td>${fmt(totalGoal)}</td>
        <td>${yen(totalSales)}</td>
        <td class="${tp>=1?"achieved":"low"}">${tp>0?(tp*100).toFixed(1)+"%":"-"}</td>
      </tr></tbody>`;
    }
    html += `</table></div>`;
    document.getElementById("annual-content").innerHTML = html;
  } catch(e) {
    console.error("renderAnnual error:", e);
    document.getElementById("annual-content").innerHTML =
      `<div style="text-align:center;padding:40px;color:var(--danger);">読み込みエラー。再度タップしてください。</div>`;
  }
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
  document.getElementById("goal-modal-body").innerHTML = `
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
        <input class="form-input" type="text" id="ge-${s}" value="${goal["event"+s.charAt(0).toUpperCase()+s.slice(1)] || ""}" placeholder="例：団体割">
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
    bee:  parseFloat(document.getElementById("g-bee")?.value)  || 0,
    eventBero: document.getElementById("ge-bero")?.value || "",
    eventMash: document.getElementById("ge-mash")?.value || "",
    eventBee:  document.getElementById("ge-bee")?.value  || "",
  };
  await saveGoal(goalModalYear, goalModalMonth, data);
  toast(`${goalModalYear}年${goalModalMonth}月の目標を保存しました`);
  document.getElementById("goal-modal").classList.remove("open");
  updateMonthTotals();
}

// ===== Excel Export =====
async function exportExcel() {
  toast("データを準備中...");
  const year = state.calYear;
  const allGoals = await loadAllGoals(year);
  const allData = {};
  for (let m = 1; m <= 12; m++) {
    const entries = await loadMonthEntries(year, m);
    const enriched = Object.values(entries).map(e => ({
      ...e, dayType: e.dayType || classifyDay(e.date)
    }));
    allData[m] = { entries: enriched, goals: allGoals[m] || {} };
  }
  try {
    const payload = JSON.stringify({ year, currentMonth: state.calMonth, data: allData }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `sales_${year}.json`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast("JSONをダウンロードしました");
  } catch(e) {
    console.error(e);
    toast("エクスポート失敗", "error");
  }
}

// ===== Event Listeners =====
function setupEvents() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
      if (btn.dataset.tab === "summary") renderSummary();
      if (btn.dataset.tab === "annual") renderAnnual();
    });
  });

  document.getElementById("prev-month").addEventListener("click", () => {
    state.calMonth--; if (state.calMonth < 1) { state.calMonth=12; state.calYear--; }
    subscribeMonth(state.calYear, state.calMonth); updateMonthTotals();
  });
  document.getElementById("next-month").addEventListener("click", () => {
    state.calMonth++; if (state.calMonth > 12) { state.calMonth=1; state.calYear++; }
    subscribeMonth(state.calYear, state.calMonth); updateMonthTotals();
  });
  document.getElementById("sum-prev").addEventListener("click", () => {
    state.sumMonth--; if (state.sumMonth < 1) { state.sumMonth=12; state.sumYear--; }
    renderSummary();
  });
  document.getElementById("sum-next").addEventListener("click", () => {
    state.sumMonth++; if (state.sumMonth > 12) { state.sumMonth=1; state.sumYear++; }
    renderSummary();
  });
  document.getElementById("ann-prev").addEventListener("click", () => { state.annYear--; renderAnnual(); });
  document.getElementById("ann-next").addEventListener("click", () => { state.annYear++; renderAnnual(); });

  document.querySelectorAll(".store-tab").forEach(tab => {
    tab.addEventListener("click", async () => {
      await saveCurrentEntry();
      document.querySelectorAll(".store-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      state.currentStore = tab.dataset.store;
      await renderInputForm(tab.dataset.store);
    });
  });

  document.getElementById("save-entry-btn").addEventListener("click", async () => {
    await saveCurrentEntry();
    document.getElementById("input-modal").classList.remove("open");
  });
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
    `<div style="color:#d93025;text-align:center;padding:20px;">
      <p>接続エラー</p>
      <p style="font-size:12px;margin-top:8px;">firebase-config.js の設定を確認してください</p>
    </div>`;
});
