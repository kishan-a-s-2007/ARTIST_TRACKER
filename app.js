const API_URL = '/api/performances';
let charts = {};
let allRecords = [];
let currentCalDate = new Date();
let dismissedCompletionIds = new Set();
let todayAlertShown = false;

/* =========================================================
   1. TAB NAVIGATION CONTROLLER
   ========================================================= */
function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === tabId);
    });

    if (tabId === 'tab-analytics') {
        renderCharts(allRecords);
    }
}

/* =========================================================
   2. ARTIST TRACKER CORE LOGIC
   ========================================================= */
const dateInput = document.getElementById('date');
const hourSelect = document.getElementById('time-hour');
const minuteSelect = document.getElementById('time-minute');
const ampmSelect = document.getElementById('time-ampm');
const bookingBadge = document.getElementById('booking-badge');
const futureNote = document.getElementById('future-note');
const moneyFields = document.querySelectorAll('.money-field');
const earningsInput = document.getElementById('earnings');
const expensesInput = document.getElementById('expenses');
const liveProfitInput = document.getElementById('live-profit');

function getTodayStr() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function getFormatted12HourTime() {
    return `${hourSelect.value}:${minuteSelect.value} ${ampmSelect.value}`;
}

function getSelectedDateTime() {
    if (!dateInput.value) return null;
    const [y, m, d] = dateInput.value.split('-').map(Number);
    let hr = parseInt(hourSelect.value, 10);
    const min = parseInt(minuteSelect.value, 10);
    const ampm = ampmSelect.value;

    if (ampm === 'PM' && hr !== 12) hr += 12;
    if (ampm === 'AM' && hr === 12) hr = 0;

    return new Date(y, m - 1, d, hr, min, 0);
}

function isShowUpcoming() {
    const selectedDT = getSelectedDateTime();
    if (!selectedDT) return true;
    return selectedDT.getTime() > Date.now();
}

function updateFormModeUI() {
    const upcoming = isShowUpcoming();
    const isEditing = Boolean(document.getElementById('record-id').value);

    if (upcoming) {
        bookingBadge.textContent = 'Upcoming Booking';
        bookingBadge.className = 'badge badge-future';
        futureNote.classList.remove('hidden');
        moneyFields.forEach(el => el.classList.add('hidden'));
        earningsInput.required = false;
        expensesInput.required = false;
        document.getElementById('submit-btn').textContent = isEditing ? 'Update Booking' : 'Save Booking';
    } else {
        bookingBadge.textContent = 'Completed Show';
        bookingBadge.className = 'badge badge-past';
        futureNote.classList.add('hidden');
        moneyFields.forEach(el => el.classList.remove('hidden'));
        earningsInput.required = true;
        expensesInput.required = true;
        document.getElementById('submit-btn').textContent = isEditing ? 'Update Show' : 'Save Show';
    }
}

dateInput.addEventListener('change', updateFormModeUI);
hourSelect.addEventListener('change', updateFormModeUI);
minuteSelect.addEventListener('change', updateFormModeUI);
ampmSelect.addEventListener('change', updateFormModeUI);

function updateLiveProfit() {
    const e = parseFloat(earningsInput.value) || 0;
    const x = parseFloat(expensesInput.value) || 0;
    const p = e - x;
    liveProfitInput.value = `₹${p.toFixed(2)}`;
    liveProfitInput.style.color = p >= 0 ? '#10B981' : '#FF5252';
}
earningsInput.addEventListener('input', updateLiveProfit);
expensesInput.addEventListener('input', updateLiveProfit);

function parseRecordDateTime(r) {
    const [y, m, d] = r.date.split('-').map(Number);
    const match = (r.time || '05:00 PM').match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!match) return new Date(y, m - 1, d, 17, 0);
    let hr = parseInt(match[1], 10);
    const min = parseInt(match[2], 10);
    const ampm = match[3].toUpperCase();
    if (ampm === 'PM' && hr !== 12) hr += 12;
    if (ampm === 'AM' && hr === 12) hr = 0;
    return new Date(y, m - 1, d, hr, min);
}

async function loadRecords() {
    const res = await fetch(API_URL);
    allRecords = await res.json();
    allRecords.sort((a, b) => parseRecordDateTime(a) - parseRecordDateTime(b));

    renderTable(allRecords);
    updateKPIs(allRecords);
    renderCalendar();
    renderCharts(allRecords);

    checkShowNotifications();
}

function checkShowNotifications() {
    const modal = document.getElementById('day-popup-modal');
    if (!modal.classList.contains('hidden')) return;

    const now = Date.now();
    const today = getTodayStr();

    const needsFinancials = allRecords.find(r => {
        const showTimeMs = parseRecordDateTime(r).getTime();
        const isFinished = showTimeMs <= now;
        const unlogged = r.earnings === 0 && r.expenses === 0;
        return isFinished && unlogged && !dismissedCompletionIds.has(r.id);
    });

    if (needsFinancials) {
        openFinancialEntryPopup(needsFinancials);
        return;
    }

    if (!todayAlertShown) {
        todayAlertShown = true;
        const todaysUpcoming = allRecords.filter(r => r.date === today && parseRecordDateTime(r).getTime() > now);
        if (todaysUpcoming.length > 0) {
            showDayPopup(today, todaysUpcoming, true);
        }
    }
}

function openFinancialEntryPopup(show) {
    const modal = document.getElementById('day-popup-modal');
    const titleEl = document.getElementById('modal-title');
    const bodyEl = document.getElementById('modal-body');
    const footerEl = document.getElementById('modal-footer');

    titleEl.textContent = `Show Completed — Log Earnings & Expenses`;
    bodyEl.innerHTML = `
        <div class="popup-card past">
            <strong>${show.title}</strong><br>
            <span style="color:#94A3B8;">Date: <b style="color:#F8FAFC;">${show.date}</b> at <b style="color:#F8FAFC;">${show.time}</b> | Venue: <b style="color:#F8FAFC;">${show.location}</b></span>
        </div>
        <div class="form-group">
            <label for="popup-earnings">Money Earned (₹)</label>
            <input type="number" id="popup-earnings" step="0.01" min="0" placeholder="0.00" required>
        </div>
        <div class="form-group">
            <label for="popup-expenses">Expenses (₹)</label>
            <input type="number" id="popup-expenses" step="0.01" min="0" value="0" required>
        </div>
        <div style="font-weight: 700; font-size: 0.9rem; color: #10B981;" id="popup-profit-preview">
            Net Profit: ₹0.00
        </div>
        <p id="popup-error" class="error"></p>
    `;

    footerEl.innerHTML = `
        <button type="button" class="btn-secondary" id="popup-later-btn">Later</button>
        <button type="button" class="btn-primary" id="popup-save-btn">Save Financials</button>
    `;

    const pEarn = document.getElementById('popup-earnings');
    const pExp = document.getElementById('popup-expenses');
    const pPrev = document.getElementById('popup-profit-preview');

    function updatePopupProfit() {
        const e = parseFloat(pEarn.value) || 0;
        const x = parseFloat(pExp.value) || 0;
        const net = e - x;
        pPrev.textContent = `Net Profit: ₹${net.toFixed(2)}`;
        pPrev.style.color = net >= 0 ? '#10B981' : '#FF5252';
    }
    pEarn.addEventListener('input', updatePopupProfit);
    pExp.addEventListener('input', updatePopupProfit);

    document.getElementById('popup-later-btn').addEventListener('click', () => {
        dismissedCompletionIds.add(show.id);
        closeModal();
    });

    document.getElementById('popup-save-btn').addEventListener('click', async () => {
        const earnVal = parseFloat(pEarn.value);
        const expVal = parseFloat(pExp.value) || 0;
        const errEl = document.getElementById('popup-error');

        if (isNaN(earnVal) || earnVal < 0 || expVal < 0) {
            errEl.textContent = 'Please enter valid non-negative amounts.';
            return;
        }

        const payload = {
            id: show.id,
            title: show.title,
            date: show.date,
            time: show.time,
            location: show.location,
            earnings: earnVal,
            expenses: expVal
        };

        const res = await fetch(API_URL, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            closeModal();
            loadRecords();
        } else {
            const data = await res.json();
            errEl.textContent = data.error || 'Failed to save.';
        }
    });

    modal.classList.remove('hidden');
    pEarn.focus();
}

function showDayPopup(dateStr, shows, isTodayAlert = false) {
    const modal = document.getElementById('day-popup-modal');
    const titleEl = document.getElementById('modal-title');
    const bodyEl = document.getElementById('modal-body');
    const footerEl = document.getElementById('modal-footer');

    titleEl.textContent = isTodayAlert
        ? `Today's Booking Alert (${dateStr})`
        : `Schedule & Financials — ${dateStr}`;

    bodyEl.innerHTML = '';
    const now = Date.now();

    shows.forEach(s => {
        const isFuture = parseRecordDateTime(s).getTime() > now;
        const card = document.createElement('div');
        card.className = `popup-card ${isFuture ? 'future' : 'past'}`;

        if (isFuture) {
            card.innerHTML = `
                <strong style="color:#00E5FF;">UPCOMING: ${s.title}</strong><br>
                <span style="color:#94A3B8;">Time: <b style="color:#F8FAFC;">${s.time}</b> | Venue: <b style="color:#F8FAFC;">${s.location}</b></span>
            `;
        } else {
            const unlogged = s.earnings === 0 && s.expenses === 0;
            card.innerHTML = `
                <strong style="color:#34D399;">COMPLETED: ${s.title}</strong><br>
                <span style="color:#94A3B8;">Time: <b style="color:#F8FAFC;">${s.time}</b> | Venue: <b style="color:#F8FAFC;">${s.location}</b></span><br>
                <span style="color:#94A3B8;">Earned: <b style="color:#00E5FF;">₹${s.earnings.toFixed(2)}</b> | Expenses: <b style="color:#FF5252;">₹${s.expenses.toFixed(2)}</b></span><br>
                <span style="color:${s.profit >= 0 ? '#10B981' : '#FF5252'}">Net Profit: <b>₹${s.profit.toFixed(2)}</b></span>
                ${unlogged ? `<br><button type="button" class="btn-primary" style="margin-top:8px;padding:0.35rem 0.75rem;font-size:0.8rem;" onclick='openFinancialEntryPopup(${JSON.stringify(s)})'>Enter Earnings &amp; Expenses</button>` : ''}
            `;
        }
        bodyEl.appendChild(card);
    });

    footerEl.innerHTML = `<button type="button" class="btn-primary" onclick="closeModal()">Close</button>`;
    modal.classList.remove('hidden');
}

function closeModal() {
    document.getElementById('day-popup-modal').classList.add('hidden');
}

function renderCalendar() {
    const grid = document.getElementById('calendar-grid');
    const monthYearLabel = document.getElementById('cal-month-year');
    grid.innerHTML = '';

    const year = currentCalDate.getFullYear();
    const month = currentCalDate.getMonth();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    monthYearLabel.textContent = `${monthNames[month]} ${year}`;

    const firstDayIndex = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayStr = getTodayStr();
    const now = Date.now();

    for (let i = 0; i < firstDayIndex; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'cal-day empty';
        grid.appendChild(emptyCell);
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayShows = allRecords.filter(r => r.date === dateStr);

        const cell = document.createElement('div');
        cell.className = 'cal-day' + (dateStr === todayStr ? ' today' : '');
        cell.innerHTML = `<div class="cal-day-num">${day}</div>`;

        dayShows.forEach(s => {
            const isFuture = parseRecordDateTime(s).getTime() > now;
            const ev = document.createElement('div');
            ev.className = `cal-event ${isFuture ? 'future' : 'past'}`;
            ev.textContent = `${s.time} ${s.title}`;
            cell.appendChild(ev);
        });

        cell.addEventListener('click', () => {
            if (dayShows.length > 0) {
                showDayPopup(dateStr, dayShows, false);
            } else {
                dateInput.value = dateStr;
                updateFormModeUI();
                document.getElementById('title').focus();
            }
        });

        grid.appendChild(cell);
    }
}

function changeMonth(offset) {
    currentCalDate.setMonth(currentCalDate.getMonth() + offset);
    renderCalendar();
}

document.getElementById('search-input').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    const filtered = allRecords.filter(r =>
        r.title.toLowerCase().includes(q) ||
        r.location.toLowerCase().includes(q) ||
        r.date.includes(q)
    );
    renderTable(filtered);
});

function renderTable(records) {
    const tbody = document.getElementById('records-body');
    tbody.innerHTML = '';
    const now = Date.now();

    records.forEach(r => {
        const tr = document.createElement('tr');
        const isFuture = parseRecordDateTime(r).getTime() > now;
        const profitClass = r.profit >= 0 ? 'text-emerald' : 'text-rose';
        const statusBadge = isFuture
            ? `<span class="badge badge-future">Upcoming</span>`
            : `<span class="badge badge-past">Completed</span>`;

        const unlogged = !isFuture && r.earnings === 0 && r.expenses === 0;
        const actionBtn = unlogged
            ? `<button class="btn-primary" style="padding:0.3rem 0.65rem;font-size:0.78rem;" onclick='openFinancialEntryPopup(${JSON.stringify(r)})'>Log Money</button>`
            : `<button class="btn-edit" onclick='editRecordFromLedger(${JSON.stringify(r)})'>Edit</button>`;

        tr.innerHTML = `
            <td>${statusBadge}</td>
            <td><strong>${r.title}</strong></td>
            <td>${r.date} · <b>${r.time}</b></td>
            <td>${r.location}</td>
            <td>${isFuture ? '—' : '₹' + r.earnings.toFixed(2)}</td>
            <td>${isFuture ? '—' : '₹' + r.expenses.toFixed(2)}</td>
            <td class="${isFuture ? '' : profitClass}" style="font-weight:700;">${isFuture ? 'Pending' : '₹' + r.profit.toFixed(2)}</td>
            <td>
                ${actionBtn}
                <button class="btn-delete" onclick="deleteRecord('${r.id}')">Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function updateKPIs(records) {
    const now = Date.now();
    const pastShows = records.filter(r => parseRecordDateTime(r).getTime() <= now);
    const upcomingShows = records.filter(r => parseRecordDateTime(r).getTime() > now);

    const totalEarn = pastShows.reduce((sum, r) => sum + r.earnings, 0);
    const totalExp = pastShows.reduce((sum, r) => sum + r.expenses, 0);
    const netProfit = totalEarn - totalExp;
    const avgProfit = pastShows.length > 0 ? netProfit / pastShows.length : 0;
    const expenseRatio = totalEarn > 0 ? (totalExp / totalEarn) * 100 : 0;
    const profitMargin = totalEarn > 0 ? (netProfit / totalEarn) * 100 : 0;

    document.getElementById('kpi-shows').textContent = pastShows.length;
    document.getElementById('kpi-upcoming').textContent = upcomingShows.length;
    document.getElementById('kpi-earnings').textContent = `₹${totalEarn.toFixed(2)}`;
    document.getElementById('kpi-profit').textContent = `₹${netProfit.toFixed(2)}`;

    document.getElementById('nav-profit').textContent = `₹${netProfit.toFixed(2)}`;
    document.getElementById('nav-margin').textContent = `${profitMargin.toFixed(1)}%`;

    document.getElementById('stat-avg-profit').textContent = `₹${avgProfit.toFixed(2)}`;
    document.getElementById('stat-total-exp').textContent = `₹${totalExp.toFixed(2)}`;
    document.getElementById('stat-exp-ratio').textContent = `${expenseRatio.toFixed(1)}%`;
    document.getElementById('stat-margin').textContent = `${profitMargin.toFixed(1)}%`;
}

document.getElementById('performance-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('error-msg');
    errorEl.textContent = '';

    const id = document.getElementById('record-id').value;
    const upcoming = isShowUpcoming();

    const payload = {
        id: id,
        title: document.getElementById('title').value.trim(),
        date: document.getElementById('date').value,
        time: getFormatted12HourTime(),
        location: document.getElementById('location').value.trim(),
        earnings: upcoming ? 0 : (parseFloat(earningsInput.value) || 0),
        expenses: upcoming ? 0 : (parseFloat(expensesInput.value) || 0)
    };

    const method = id ? 'PUT' : 'POST';
    const res = await fetch(API_URL, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
        errorEl.textContent = data.error || 'Validation failed';
        return;
    }

    resetForm();
    loadRecords();
});

function editRecordFromLedger(record) {
    switchTab('tab-overview');
    document.getElementById('form-title').textContent = 'Edit Record';
    document.getElementById('record-id').value = record.id;
    document.getElementById('title').value = record.title;
    document.getElementById('date').value = record.date;

    const match = (record.time || '05:00 PM').match(/(\d{2}):(\d{2}) (AM|PM)/);
    if (match) {
        hourSelect.value = match[1];
        minuteSelect.value = match[2];
        ampmSelect.value = match[3];
    }

    document.getElementById('location').value = record.location;
    earningsInput.value = record.earnings || '';
    expensesInput.value = record.expenses || 0;
    updateFormModeUI();
    updateLiveProfit();
    document.getElementById('cancel-btn').classList.remove('hidden');
}

document.getElementById('cancel-btn').addEventListener('click', resetForm);

function resetForm() {
    document.getElementById('performance-form').reset();
    document.getElementById('record-id').value = '';
    dateInput.value = getTodayStr();
    hourSelect.value = '05';
    minuteSelect.value = '00';
    ampmSelect.value = 'PM';
    expensesInput.value = '0';
    document.getElementById('form-title').textContent = 'Schedule or Log Show';
    document.getElementById('cancel-btn').classList.add('hidden');
    document.getElementById('live-profit').value = '₹0.00';
    updateFormModeUI();
}

async function deleteRecord(id) {
    if (!confirm('Delete this record?')) return;
    await fetch(`${API_URL}?id=${id}`, { method: 'DELETE' });
    loadRecords();
}

function renderCharts(records) {
    const now = Date.now();
    const completedRecords = records.filter(r => parseRecordDateTime(r).getTime() <= now);
    const monthlyMap = {};

    records.forEach(r => {
        const month = r.date.substring(0, 7);
        if (!monthlyMap[month]) monthlyMap[month] = { earnings: 0, expenses: 0, profit: 0, count: 0 };
        if (parseRecordDateTime(r).getTime() <= now) {
            monthlyMap[month].earnings += r.earnings;
            monthlyMap[month].expenses += r.expenses;
            monthlyMap[month].profit += r.profit;
        }
        monthlyMap[month].count += 1;
    });

    const months = Object.keys(monthlyMap).sort();
    const monthlyEarnings = months.map(m => monthlyMap[m].earnings);
    const monthlyExpenses = months.map(m => monthlyMap[m].expenses);
    const monthlyProfits = months.map(m => monthlyMap[m].profit);
    const scatterData = months.map((m, idx) => ({ x: idx + 1, y: monthlyMap[m].count, month: m }));

    const totalEarn = completedRecords.reduce((s, r) => s + r.earnings, 0);
    const totalExp = completedRecords.reduce((s, r) => s + r.expenses, 0);
    const totalProfit = Math.max(0, totalEarn - totalExp);

    Object.values(charts).forEach(c => c.destroy());

    const darkGrid = { color: 'rgba(148, 163, 184, 0.12)' };
    const darkTicks = { color: '#94A3B8' };
    const legendLabels = { color: '#E2E8F0' };

    charts.bar = new Chart(document.getElementById('monthlyBarChart'), {
        type: 'bar',
        data: {
            labels: months,
            datasets: [
                { label: 'Earnings (₹)', data: monthlyEarnings, backgroundColor: '#00E5FF', borderRadius: 4 },
                { label: 'Expenses (₹)', data: monthlyExpenses, backgroundColor: '#FF5252', borderRadius: 4 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { labels: legendLabels } },
            scales: {
                x: { grid: darkGrid, ticks: darkTicks },
                y: { grid: darkGrid, ticks: darkTicks }
            }
        }
    });

    charts.pie = new Chart(document.getElementById('profitPieChart'), {
        type: 'doughnut',
        data: {
            labels: ['Net Profit', 'Total Expenses'],
            datasets: [{
                data: [totalProfit, totalExp],
                backgroundColor: ['#10B981', '#FF5252'],
                borderColor: '#131F3A',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'right', labels: legendLabels } }
        }
    });

    charts.scatter = new Chart(document.getElementById('showScatterChart'), {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'Shows per Month',
                data: scatterData,
                backgroundColor: '#F59E0B',
                pointRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: legendLabels },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${ctx.raw.month}: ${ctx.raw.y} show(s)`
                    }
                }
            },
            scales: {
                x: {
                    type: 'linear',
                    grid: darkGrid,
                    ticks: { color: '#94A3B8', callback: (val) => months[val - 1] || '' }
                },
                y: { beginAtZero: true, grid: darkGrid, ticks: { color: '#94A3B8', stepSize: 1 } }
            }
        }
    });

    charts.line = new Chart(document.getElementById('profitLineChart'), {
        type: 'line',
        data: {
            labels: months,
            datasets: [{
                label: 'Monthly Net Profit (₹)',
                data: monthlyProfits,
                borderColor: '#10B981',
                backgroundColor: 'rgba(16, 185, 129, 0.14)',
                pointBackgroundColor: '#00E5FF',
                fill: true,
                tension: 0.35
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { labels: legendLabels } },
            scales: {
                x: { grid: darkGrid, ticks: darkTicks },
                y: { grid: darkGrid, ticks: darkTicks }
            }
        }
    });
}

setInterval(() => {
    renderTable(allRecords);
    updateKPIs(allRecords);
    renderCalendar();
    checkShowNotifications();
}, 15000);

dateInput.value = getTodayStr();
updateFormModeUI();
loadRecords();
