import { db } from "./firebase-config.js";
import {
  collection, doc, setDoc, getDoc, getDocs,
  onSnapshot
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
// 内閣府発表の祝日リスト
const HOLIDAYS = new Set([
  // 2024
  "2024-01-01","2024-01-08","2024-02-11","2024-02-12","2024-02-23",
  "2024-03-20","2024-04-29","2024-05-03","2024-05-04","2024-05-05","2024-05-06",
  "2024-07-15","2024-08-11","2024-08-12","2024-09-16","2024-09-22","2024-09-23",
  "2024-10-14","2024-11-03","2024-11-04","2024-11-23",
  // 2025
  "2025-01-01","2025-01-13","2025-02-11","2025-02-23","2025-02-24",
  "2025-03-20","2025-04-29","2025-05-03","2025-05-04","2025-05-05","2025-05-06",
  "2025-07-21","2025-08-11","2025-09-15","2025-09-22","2025-09-23",
  "2025-10-13","2025-11-03","2025-11-23","2025-11-24",
  // 2026
  "2026-01-01","2026-01-12","2026-02-11","2026-02-23",
  "2026-03-20","2026-04-29","2026-05-03","2026-05-04","2026-05-05","2026-05-06",
  "2026-07-20","2026-08-11","2026-09-21","2026-09-22","2026-09-23",
  "2026-10-12","2026-11-03","2026-11-23",
  // 2027
  "2027-01-01","2027-01-11","2027-02-11","2027-02-23",
  "2027-03-21","2027-03-22","2027-04-29","2027-05-03","2027-05-04","2027-05-05",
  "2027-07-19","2027-08-11","2027-09-20","2027-09-23",
  "2027-10-11","2027-11-03","2027-11-23",
]);

function isHoliday(dateStr) { return HOLIDAYS.has(dateStr); }

// 日付文字列を返す
function dateStr(year, month, day) {
  return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
}

// 連休グループを求める: 祝日+土日の連続した塊を返す
// 戻り値: Map<dateStr, Set<dateStr>> (各日→その連休グループ)
function buildHolidayGroups(year, month) {
  const days = new Date(year, month, 0).getDate();
  // 月の前後3日も含めて判定
  const allDays = [];
  for (let d = -2; d <= days + 2; d++) {
    const dt = new Date(year, month - 1, d);
    const ds = dt.toISOString().split("T")[0];
    const dow = dt.getDay();
    if (isHoliday(ds) || dow === 0 || dow === 6) {
      allDays.push(ds);
    }
  }
  // 連続する日付をグループ化
  const groups = [];
  for (const ds of allDays) {
    const d = new Date(ds + "T00:00:00");
    if (groups.length === 0) { groups.push([ds]); continue; }
    const last = groups[groups.length - 1];
    const lastD = new Date(last[last.length - 1] + "T00:00:00");
    const diff = (d - lastD) / 86400000;
    if (diff === 1) last.push(ds);
    else groups.push([ds]);
  }
  return groups;
}

// ある日が「週末扱い」かどうか判定
// 週末扱い: 金曜・土曜・祝前日・連休の最終日以外の日
// 平日扱い: 上記以外の日・連休最終日
function classifyDay(dateStr) {
  const dt = new Date(dateStr + "T00:00:00");
  const dow = dt.getDay(); // 0=日,1=月,...,6=土
  const year = dt.getFullYear();
  const month = dt.getMonth() + 1;

  // 金曜・土曜は常に週末
  if (dow === 5 || dow === 6) return "weekend";

  // 祝日かチェック
  const isHol = isHoliday(dateStr);
  // 翌日が祝日かチェック（祝前日判定用）
  const nextDt = new Date(dt); nextDt.setDate(nextDt.getDate() + 1);
  const nextDs = nextDt.toISOString().split("T")[0];
  const nextIsHol = isHoliday(nextDs);
  const nextDow = nextDt.getDay();

  // 翌日が祝日または土日 → 祝前日 → 週末扱い
  if (nextIsHol || nextDow === 6) return "weekend";

  if (!isHol) return "weekday"; // 普通の平日

  // 祝日の場合: 連休グループを調べる
  const groups = buildHolidayGroups(year, month);
  for (const group of groups) {
    if (!group.includes(dateStr)) continue;
    if (group.length === 1) {
      // 単独祝日: 平日扱い
      return "weekday";
    }
    // 連休: 最終日のみ平日、それ以外は週末
    return group[group.length - 1] === dateStr ? "weekday" : "weekend";
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
function ym(y, m) { return `${y}-${String(m).padStart(2, "0")}`; }
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

// ===== 残り営業日計算 =====
// cutDay以降の平日・週末日数を返す
function remainingDays(year, month, cutDay) {
  const days = new Date(year, month, 0).getDate();
  let remWkday = 0, remWkend = 0;
  for (let d = cutDay + 1; d <= days; d++) {
    const ds = dateStr(year, month, d);
    if (classifyDay(ds) === "weekend") remWkend++;
    else remWkday++;
  }
  return { remWkday, remWkend };
}

// 月内の全日を平日/週末に分類してカウント
function countMonthDays(year, month) {
  const days = new Date(year, month, 0).getDate();
  let wkday = 0, wkend = 0;
  for (let d = 1; d <= days; d++) {
    const ds = dateStr(year, month, d);
    if (classifyDay(ds) === "weekend") wkend++;
    else wkday++;
  }
  return { wkday, wkend };
}

// ===== Calendar =====
function renderCalendar() {
  const { calYear, calMonth } = state;
  document.getElementById("month-display").textContent = `${calYear}年 ${calMonth}月`;

  const firstDay = new Date(calYear, calMonth - 1, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth, 0).getDate();
  const todayStr = today();
  const ymStr = ym(calYear, calMonth);

  const grid = document.getElementById("calendar-grid");
  grid.innerHTML = "";

  ["日","月","火","水","木","金","土"].forEach((d, i) => {
    const el = document.createElement("div");
    el.className = `cal-weekday ${i === 0 ? "sun" : i === 6 ? "sat" : ""}`;
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
    // 色分け: 週末扱いは青/赤系、祝日も
    if (dow === 0 || (hol && dow !== 6 && dow !== 5)) classes.push("sun");
    if (dow === 6 || dow === 5) classes.push(dow === 6 ? "sat" : "fri");
    el.className = classes.join(" ");
    el.style.position = "relative";

    // 祝日マーク
    if (hol) {
      const mark = document.createElement("div");
      mark.style.cssText = "position:absolute;top:3px;right:4px;width:4px;height:4px;border-radius:50%;background:#d93025;opacity:0.7;";
      el.appendChild(mark);
    }
    // 週末扱いの背景（薄く）
    if (dayType === "weekend" && ds !== todayStr) {
      el.style.background = "rgba(37,118,212,0.04)";
    }

    const numEl = document.createElement("div");
    numEl.className = "day-num";
    numEl.textContent = d;
    // 金曜も青色に
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

  if (store === "mash") {
    const salesEl = document.getElementById("f-sales");
    const guestsEl = document.getElementById("f-guests");
    const unitEl = document.getElementById("f-unit");
    function calc() {
      const s = parseFloat(salesEl.value) || 0;
      const g = parseFloat(guestsEl.value) || 0;
      unitEl.value = g > 0 ? Math.round(s / g) : "";
    }
    salesEl.addEventListener("input", calc);
    guestsEl.addEventListener("input", calc);
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

  // 日付の種別を保存
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
  const cutDay = isCurrentMonth ? now.getDate() : new Date(sumYear, sumMonth, 0).getDate();
  const { remWkday, remWkend } = remainingDays(sumYear, sumMonth, cutDay);

  let html = "";
  for (const store of STORES) {
    const g = goal[store] || 0;
    const total = allEntries.reduce((a, e) => a + (e[store]?.sales || 0), 0);
    const pct = g > 0 ? total / g : 0;
    const remaining = Math.max(0, g - total);

    // 平日/週末を classifyDay で再判定（保存済み dayType があれば使う）
    const wkdayEntries = allEntries.filter(e => (e.dayType || classifyDay(e.date)) === "weekday");
    const wkendEntries = allEntries.filter(e => (e.dayType || classifyDay(e.date)) === "weekend");

    // 平均は実際に売上がある営業日のみでカウント
    const wkdaySales = wkdayEntries.filter(e => (e[store]?.sales || 0) > 0).map(e => e[store].sales);
    const wkendSales = wkendEntries.filter(e => (e[store]?.sales || 0) > 0).map(e => e[store].sales);
    const wkdayAvg = wkdaySales.length ? wkdaySales.reduce((a,b)=>a+b,0) / wkdaySales.length : 0;
    const wkendAvg = wkendSales.length ? wkendSales.reduce((a,b)=>a+b,0) / wkendSales.length : 0;

    const totalGuests = allEntries.reduce((a, e) => a + (e[store]?.guests || 0), 0);
    const totalGroups = allEntries.reduce((a, e) => a + (e[store]?.groups || 0), 0);
    const avgUnit = totalGuests > 0 ? total / totalGuests : 0;
    const avgGUnit = totalGroups > 0 ? total / totalGroups : 0;
    const newrateAvg = store === "mash" && allEntries.length
      ? allEntries.reduce((a, e) => a + (e[store]?.newrate || 0), 0) / allEntries.length : null;

    // 残り目標: 平日/週末の実績平均の比率から按分して計算
    // ウェイト = 平均 × 残り日数 で比率を決め、残り金額を按分
    let wkdayTgt = 0, wkendTgt = 0;
    const hasWkday = wkdayAvg > 0 && remWkday > 0;
    const hasWkend = wkendAvg > 0 && remWkend > 0;
    if (hasWkday && hasWkend) {
      const weightWkday = wkdayAvg * remWkday;
      const weightWkend = wkendAvg * remWkend;
      const totalWeight = weightWkday + weightWkend;
      const allocWkday = remaining * (weightWkday / totalWeight);
      const allocWkend = remaining * (weightWkend / totalWeight);
      wkdayTgt = allocWkday / remWkday;
      wkendTgt = allocWkend / remWkend;
    } else if (hasWkday) {
      wkdayTgt = remaining / remWkday;
    } else if (hasWkend) {
      wkendTgt = remaining / remWkend;
    } else if (remWkday + remWkend > 0) {
      const perDay = remaining / (remWkday + remWkend);
      wkdayTgt = remWkday > 0 ? perDay : 0;
      wkendTgt = remWkend > 0 ? perDay : 0;
    }

    const pc = pctClass(pct);
    const fc = fillClass(pct);

    html += `<div class="summary-store-card">
      <div class="store-card-header">
        <span class="store-card-name" style="color:${STORE_COLORS[store]}">${STORE_NAMES[store]}</span>
        <span class="store-card-pct ${pc}">${(pct * 100).toFixed(1)}%</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill ${fc}" style="width:${Math.min(100,pct*100)}%"></div>
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
          <span class="metric-label">平日平均（${wkdaySales.length}日）</span>
          <span class="metric-value">${yen(wkdayAvg)}</span>
        </div>
        <div class="metric-cell">
          <span class="metric-label">週末平均（${wkendSales.length}日）</span>
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
          <span class="footer-value">平日${wkdaySales.length}日・週末${wkendSales.length}日</span>
        </div>
      </div>
    </div>`;
  }

  // イベント情報
  const events = [
    { store: "bero", event: goal.eventBero },
    { store: "mash", event: goal.eventMash },
    { store: "bee", event: goal.eventBee },
  ].filter(e => e.event);
  if (events.length) {
    html += `<div class="summary-store-card" style="margin-top:0;">
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
    const totalPct = totalGoal > 0 && totalSales > 0 ? totalSales / totalGoal : 0;
    html += `<tr>
      <td>合計</td><td>${fmt(totalGoal)}</td>
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

// ===== Excel Export =====
async function exportExcel() {
  toast("データを準備中...", "success");
  const year = state.calYear;
  const allGoals = await loadAllGoals(year);
  const allData = {};
  for (let m = 1; m <= 12; m++) {
    const entries = await loadMonthEntries(year, m);
    // dayType を再計算して付与
    const enriched = Object.values(entries).map(e => ({
      ...e,
      dayType: e.dayType || classifyDay(e.date)
    }));
    allData[m] = { entries: enriched, goals: allGoals[m] || {} };
  }
  const payload = JSON.stringify({ year, currentMonth: state.calMonth, data: allData });
  try {
    await window.storage.set("export_payload", payload);
    if (typeof sendPrompt === "function") {
      sendPrompt(`売上データのExcelファイルを生成してください。ストレージキー "export_payload" にJSONデータが保存されています。`);
    }
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
