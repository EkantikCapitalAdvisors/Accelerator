// =====================================================
// TRADOVATE CSV PARSER & DB PERSISTENCE
// Ekantik Accelerator Dashboard
// =====================================================

const TENX_RISK = 500;               // $500 per day (5% of $10k)
const TENX_PPT = 5;                  // $5 per point (MES default)
const TENX_STARTING_BALANCE = 10000; // $10,000 starting portfolio

// PPT lookup for mixed instruments
const PPT_BY_PRODUCT = { ES: 50, MES: 5 };

// Setup Quality tracking: only count trades ON or AFTER this date toward aggregate %
// Pre-tracking trades still get per-rule annotations but don't affect the scorecard number
const SETUP_QUALITY_START_DATE = '2026-04-18'; // YYYY-MM-DD — first trade after rule adoption

// ===== DATABASE API — GitHub-backed persistence =====
const DB = {
    OWNER: 'EkantikCapitalAdvisors',
    REPO:  'Accelerator',
    BRANCH: 'main',

    _token() { return localStorage.getItem('gh-token') || ''; },

    async _read(filename) {
        // Prefer the Contents API for writes-then-reads (strong consistency).
        // raw.githubusercontent.com has a ~5-min CDN cache that ignores ?cb=
        // params under load, which lets back-to-back commits overwrite each
        // other when each one merges against a stale read. Falls back to raw
        // only if the Contents API is unavailable (offline / no token / 5xx).
        const token = DB._token();
        const apiUrl = `https://api.github.com/repos/${DB.OWNER}/${DB.REPO}/contents/data/${filename}.json?ref=${DB.BRANCH}&_=${Date.now()}`;
        try {
            const headers = { Accept: 'application/vnd.github.v3+json' };
            if (token) headers.Authorization = `token ${token}`;
            const res = await fetch(apiUrl, { headers, cache: 'no-store' });
            if (res.status === 404) return [];
            if (res.ok) {
                const json = await res.json();
                const text = decodeURIComponent(escape(atob(json.content.replace(/\n/g, ''))));
                const data = JSON.parse(text);
                return Array.isArray(data) ? data : [];
            }
        } catch (e) { /* fall through to raw */ }

        const rawUrl = `https://raw.githubusercontent.com/${DB.OWNER}/${DB.REPO}/${DB.BRANCH}/data/${filename}.json?cb=${Date.now()}`;
        const res = await fetch(rawUrl, { cache: 'no-store' });
        if (res.status === 404) return [];
        if (!res.ok) throw new Error(`Read ${filename}: HTTP ${res.status}`);
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    },

    async _write(filename, data, message) {
        const token = DB._token();
        if (!token) throw new Error('No GitHub token — click ⚙ GitHub Sync to add your token.');

        const apiUrl = `https://api.github.com/repos/${DB.OWNER}/${DB.REPO}/contents/data/${filename}.json`;
        const headers = {
            Authorization: `token ${token}`,
            Accept: 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        };

        const attempt = async () => {
            let sha = null;
            // Cache-bust the SHA fetch — GitHub's contents API sends
            // Cache-Control: private, max-age=60, which means the browser
            // would otherwise hand us a stale SHA on back-to-back commits
            // made within a minute of each other.
            const shaUrl = `${apiUrl}?ref=${DB.BRANCH}&_=${Date.now()}`;
            const infoRes = await fetch(shaUrl, { headers, cache: 'no-store' });
            if (infoRes.ok) {
                sha = (await infoRes.json()).sha;
            } else if (infoRes.status !== 404) {
                throw new Error(`SHA fetch failed: ${infoRes.status}`);
            }

            const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
            const body = { message, content, branch: DB.BRANCH };
            if (sha) body.sha = sha;

            const res = await fetch(apiUrl, { method: 'PUT', headers, body: JSON.stringify(body) });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                const e = new Error(err.message || `Write failed: ${res.status}`);
                e.status = res.status;
                throw e;
            }
            return true;
        };

        const isShaConflict = (e) =>
            e.status === 409 ||
            e.status === 422 ||
            (e.message && /does not match|sha|conflict/i.test(e.message));

        for (let i = 0; i < 4; i++) {
            try {
                return await attempt();
            } catch (e) {
                if (isShaConflict(e) && i < 3) {
                    console.warn(`[GitHubDB] SHA conflict on attempt ${i + 1}/4 — retrying…`, e.message);
                    await new Promise(r => setTimeout(r, 200 * (i + 1)));
                    continue;
                }
                throw e;
            }
        }
    },

    // ─── Public API ──────
    async loadTrades(tableName) {
        try { return await DB._read(tableName); }
        catch (e) { console.warn(`[GitHubDB] loadTrades(${tableName}):`, e); return []; }
    },

    async saveTrades(tableName, trades, batchId) {
        const norm = v => Math.round(parseFloat(v) * 10000) / 10000;
        const makeKey = (r) => r.trade_num
            ? r.trade_num
            : `${r.entry_time}|${r.exit_time}|${r.direction}|${norm(r.dollar_pl)}`;
        const makeTradeKey = (t) => t.tradeNum
            ? t.tradeNum
            : `${t.entryTime}|${t.exitTime}|${t.direction}|${norm(t.dollarPL)}`;

        // Re-read-merge-write: each attempt fetches the latest committed state,
        // dedups against it, and writes. If the write fails with a SHA mismatch,
        // the caller retries and we start over from a fresh read — so concurrent
        // commits are never silently overwritten.
        const isShaConflict = (e) =>
            e.status === 409 ||
            e.status === 422 ||
            (e.message && /does not match|sha|conflict/i.test(e.message));

        for (let i = 0; i < 4; i++) {
            const existing = await DB._read(tableName);
            const keys = new Set(existing.map(makeKey));
            const newRows = trades
                .filter(t => !keys.has(makeTradeKey(t)))
                .map(t => ({
                    week_key:     getWeekKey(t.date),
                    trade_num:    t.tradeNum    || '',
                    entry_time:   t.entryTime   || t.datetime || '',
                    exit_time:    t.exitTime    || '',
                    direction:    t.direction,
                    entry_price:  t.entryPrice,
                    exit_price:   t.exitPrice   || 0,
                    stop_price:   t.stopPrice   || 0,
                    contracts:    t.contracts   || 1,
                    points_pl:    t.pointsPL,
                    dollar_pl:    t.dollarPL,
                    risk_points:  t.riskPoints  || 0,
                    risk_dollars: t.riskDollars || 0,
                    reward_risk:  t.rewardRisk  || 0,
                    is_win:       t.isWin,
                    trade_date:   t.date,
                    product:      t.product     || 'MES',
                    ppt:          t.ppt         || 5,
                    source:       t.source      || 'tradovate',
                    upload_batch: batchId
                }));
            if (newRows.length === 0) return; // all dupes

            try {
                await DB._write(tableName, [...existing, ...newRows],
                    `Update ${tableName}: +${newRows.length} trades [${batchId}]`);
                return;
            } catch (e) {
                if (isShaConflict(e) && i < 3) {
                    console.warn(`[GitHubDB] saveTrades retry ${i + 1}/4 after conflict:`, e.message);
                    await new Promise(r => setTimeout(r, 250 * (i + 1)));
                    continue;
                }
                throw e;
            }
        }
    },

    async saveAllWeeklySnapshots(method, snapshots) {
        const all = await DB._read('weekly_snapshots');
        const merged = [...all.filter(s => s.method !== method), ...snapshots];
        await DB._write('weekly_snapshots', merged,
            `Snapshots ${method}: ${snapshots.length} weeks [${new Date().toISOString().slice(0, 10)}]`);
    },

    async saveWeeklySnapshot(snapshot) {
        try {
            const all = await DB._read('weekly_snapshots');
            const idx = all.findIndex(s => s.method === snapshot.method && s.week_key === snapshot.week_key);
            if (idx >= 0) all[idx] = snapshot; else all.push(snapshot);
            await DB._write('weekly_snapshots', all,
                `Snapshot ${snapshot.method} ${snapshot.week_key}`);
        } catch (e) { console.warn('[GitHubDB] saveWeeklySnapshot:', e); }
    },

    async loadWeeklySnapshots(method) {
        try {
            const all = await DB._read('weekly_snapshots');
            return all
                .filter(s => s.method === method)
                .sort((a, b) => parseWeekKey(a.week_key) - parseWeekKey(b.week_key));
        } catch (e) { console.warn('[GitHubDB] loadWeeklySnapshots:', e); return []; }
    },

    async deleteTradesByBatch(tableName, batchId) {
        try {
            const existing = await DB._read(tableName);
            const filtered = existing.filter(r => r.upload_batch !== batchId);
            if (filtered.length < existing.length) {
                await DB._write(tableName, filtered,
                    `Delete batch ${batchId} from ${tableName}`);
            }
        } catch (e) { console.warn('[GitHubDB] deleteTradesByBatch:', e); }
    }
};

function parseWeekKey(wk) {
    const parts = wk.split('/');
    return new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
}

// Convert DB row back to trade object
function dbRowToTenxTrade(row) {
    return {
        tradeNum:    row.trade_num || '',
        entryTime:   row.entry_time,
        exitTime:    row.exit_time,
        datetime:    row.entry_time || '',
        direction:   row.direction,
        entryPrice:  row.entry_price,
        exitPrice:   row.exit_price,
        stopPrice:   row.stop_price,
        contracts:   row.contracts,
        pointsPL:    row.points_pl,
        dollarPL:    row.dollar_pl,
        riskPoints:  row.risk_points,
        riskDollars: row.risk_dollars,
        rewardRisk:  row.reward_risk || null,
        isWin:       row.is_win,
        date:        row.trade_date,
        product:     row.product || 'MES',
        ppt:         row.ppt || 5,
        source:      row.source || 'tradovate',
        outcome:     row.is_win ? 'Win' : 'Loss',
        uploadBatch: row.upload_batch
    };
}

// ===== CSV LINE PARSER (handles quoted fields) =====
function parseCSVLine(line) {
    const result = []; let current = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') inQuotes = !inQuotes;
        else if (c === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
        else current += c;
    }
    result.push(current.trim());
    return result;
}

// ===== TRADOVATE CSV PARSER =====
function parseTradovateCSV(csvText) {
    const lines = csvText.trim().split('\n');

    const allOrders = [];
    for (let i = 1; i < lines.length; i++) {
        const row = parseCSVLine(lines[i]);
        if (!row || row.length < 22) continue;

        const status = (row[11] || '').trim();
        const direction = (row[3] || '').trim();
        const avgPrice = parseFloat(row[7]) || 0;
        const filledQty = parseInt(row[8]) || 0;
        const fillTime = (row[9] || '').trim();
        const product = (row[5] || '').trim();       // "MES" or "ES"
        const timestamp = (row[17] || '').trim();
        const qty = parseInt(row[19]) || 0;
        const text = (row[20] || '').trim();
        const type = (row[21] || '').trim();
        const stopPrice = parseFloat(row[23]) || 0;

        allOrders.push({
            line: i + 1, direction, avgPrice, filledQty, fillTime, status,
            product, timestamp, qty, text, type, stopPrice,
            date: (fillTime || timestamp).split(' ')[0]
        });
    }

    const filledOrders = allOrders.filter(o => o.status === 'Filled' && o.avgPrice > 0 && o.filledQty > 0);
    const stopOrders = allOrders.filter(o => o.type === 'Stop');

    let position = 0, entryOrders = [];
    const roundTrips = [];

    for (const order of filledOrders) {
        const qty = order.direction === 'Buy' ? order.filledQty : -order.filledQty;
        const prev = position;
        position += qty;

        if (prev === 0) {
            entryOrders = [order];
        } else if (Math.sign(prev) === Math.sign(position) && position !== 0) {
            entryOrders.push(order);
        } else if (position === 0) {
            roundTrips.push(buildRoundTrip(entryOrders, order, Math.abs(prev), stopOrders, allOrders));
            entryOrders = [];
        } else {
            roundTrips.push(buildRoundTrip(entryOrders, order, Math.abs(prev), stopOrders, allOrders));
            entryOrders = [{ ...order, filledQty: Math.abs(position) }];
        }
    }

    return roundTrips;
}

function buildRoundTrip(entryOrders, exitOrder, contracts, stopOrders, allOrders) {
    let tc = 0, wp = 0;
    for (const e of entryOrders) { wp += e.avgPrice * e.filledQty; tc += e.filledQty; }
    wp /= tc;

    const entryDir = entryOrders[0].direction;
    const pp = entryDir === 'Sell' ? wp - exitOrder.avgPrice : exitOrder.avgPrice - wp;

    // Detect instrument PPT from product column (ES=$50/pt, MES=$5/pt)
    const product = entryOrders[0].product || 'MES';
    const ppt = PPT_BY_PRODUCT[product] || 5;
    const dp = pp * ppt * contracts;

    const stopDir = entryDir === 'Sell' ? 'Buy' : 'Sell';
    let stopPrice = 0;

    for (const eo of entryOrders) {
        const nearbyStops = stopOrders.filter(s =>
            s.direction === stopDir &&
            s.line > eo.line - 1 &&
            s.line <= eo.line + 4
        );
        if (nearbyStops.length > 0 && !stopPrice) {
            stopPrice = nearbyStops[0].stopPrice || 0;
        }
    }

    if (!stopPrice && exitOrder.type === 'Stop') {
        stopPrice = exitOrder.avgPrice;
    }

    if (!stopPrice) {
        const entryLine = entryOrders[0].line;
        const nearby = stopOrders.filter(s =>
            s.direction === stopDir &&
            s.line > entryLine - 2 &&
            s.line < entryLine + 8
        );
        if (nearby.length > 0) stopPrice = nearby[0].stopPrice || 0;
    }

    const riskPoints = stopPrice > 0 ? Math.abs(wp - stopPrice) : 0;
    const riskDollars = riskPoints * ppt * contracts;
    const rewardRisk = riskPoints > 0 ? pp / riskPoints : null;

    return {
        entryTime: entryOrders[0].fillTime,
        exitTime: exitOrder.fillTime,
        direction: entryDir === 'Sell' ? 'Short' : 'Long',
        entryPrice: wp,
        exitPrice: exitOrder.avgPrice,
        stopPrice,
        contracts,
        pointsPL: pp,
        dollarPL: dp,
        riskPoints,
        riskDollars,
        rewardRisk,
        isWin: dp > 0,
        date: normalizeDate(entryOrders[0].fillTime.split(' ')[0]),
        product,
        ppt
    };
}

// Normalize any date string to MM/DD/YYYY format
function normalizeDate(dateStr) {
    if (!dateStr) return '';
    const s = dateStr.trim();

    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) {
        const parts = s.split('/');
        const y = parts[2].length === 2 ? '20' + parts[2] : parts[2];
        return `${parseInt(parts[0])}/${parseInt(parts[1])}/${y}`;
    }

    if (/^\d{4}-\d{1,2}-\d{1,2}/.test(s)) {
        const parts = s.split(/[-T ]/);
        return `${parseInt(parts[1])}/${parseInt(parts[2])}/${parts[0]}`;
    }

    if (/^\d{1,2}-\d{1,2}-\d{2,4}$/.test(s)) {
        const parts = s.split('-');
        const y = parts[2].length === 2 ? '20' + parts[2] : parts[2];
        return `${parseInt(parts[0])}/${parseInt(parts[1])}/${y}`;
    }

    try {
        const d = new Date(s);
        if (!isNaN(d.getTime())) {
            return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
        }
    } catch (e) {}

    return s;
}

function extractDate(datetime) {
    if (!datetime) return '';
    const dateOnly = datetime.split(/[ T]/)[0];
    return normalizeDate(dateOnly);
}

// ===== DISCORD TRADE PARSER =====
// Parses Discord-style trade messages pasted from Discord.
// Automatically extracts timestamps from Discord message headers and date dividers.
//
// Discord copy-paste format:
//   Ekantik Capital  4/13/2026 8:33 AM
//   F37: s 6837.5
//   F37: exit
//   F37: +4.5
//   — April 14, 2026 —
//   Ekantik Capital  4/14/2026 2:05 PM
//   f40: s 6992
//   Ekantik Capital  4/15/2026 8:34 AM
//   f40: -10
//
// Also handles bare trade lines with no timestamps (uses fallback date or blank).

const MONTH_NAMES = {
    'january':1,'february':2,'march':3,'april':4,'may':5,'june':6,
    'july':7,'august':8,'september':9,'october':10,'november':11,'december':12
};

function parseDiscordTradeText(text) {
    const lines = text.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const pending = {};   // tradeNum → { direction, entryPrice, stopPrice, datetime, date }
    const completed = []; // finished trade objects
    let currentDatetime = '';
    let currentDate = '';

    for (const line of lines) {
        // 1. Discord date divider: "— April 14, 2026 —" or "April 14, 2026"
        const dividerMatch = line.match(/^—?\s*(\w+)\s+(\d{1,2}),?\s+(\d{4})\s*—?$/);
        if (dividerMatch) {
            const monthNum = MONTH_NAMES[dividerMatch[1].toLowerCase()];
            if (monthNum) {
                const day = parseInt(dividerMatch[2]);
                const year = parseInt(dividerMatch[3]);
                currentDate = `${monthNum}/${day}/${year}`;
                currentDatetime = `${year}-${String(monthNum).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
            }
            continue;
        }

        // 2. Date+time line: "Ekantik Capital  4/13/2026 8:33 AM" or bare "4/2/2026 10:12 AM"
        //    Also handles: "Ekantik Capital — 4/13/2026 8:33 AM" or with (edited)
        const headerMatch = line.match(/(?:^|\s)(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)/i);
        if (headerMatch && !line.match(/^F\d+/i)) {
            const datePart = headerMatch[1]; // e.g. "4/13/2026"
            const timePart = headerMatch[2]; // e.g. "8:33 AM"
            const dp = datePart.split('/');
            const month = parseInt(dp[0]), day = parseInt(dp[1]), year = parseInt(dp[2]);
            currentDate = `${month}/${day}/${year}`;
            currentDatetime = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')} ${timePart.trim()}`;
            continue;
        }

        // 2b. Time-only header: "Ekantik Capital  9:29 AM" (no date, use current date)
        const timeOnlyMatch = line.match(/^.+?\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM))\s*$/i);
        if (timeOnlyMatch && !line.match(/^F\d+/i)) {
            const timePart = timeOnlyMatch[1];
            if (currentDatetime) {
                // Update time portion only
                currentDatetime = currentDatetime.split(' ')[0] + ' ' + timePart.trim();
            }
            continue;
        }

        // 3. Skip "(edited)" lines or other non-trade lines
        if (/^\(edited\)$/.test(line)) continue;

        // 4. Match trade line: F##: <content>  (case insensitive)
        const m = line.match(/^(F\d+)\s*:\s*(.+)$/i);
        if (!m) continue;
        const tradeNum = m[1].toUpperCase();
        const body = m[2].trim();

        // Is this a result line? e.g. "+4.5", "-3", "-10", "+ 3", "- 2.5"
        const resultMatch = body.match(/^([+-])\s*(\d+\.?\d*)$/) || body.match(/^(\d+\.?\d*)$/);
        if (resultMatch) {
            // Handle both "sign number" (2 groups) and bare "number" (1 group) matches
            const pts = resultMatch[2] !== undefined
                ? parseFloat(resultMatch[1] + resultMatch[2])   // e.g. ["+", "3"] → +3
                : parseFloat(resultMatch[1]);                    // e.g. ["3"] → 3
            const entry = pending[tradeNum];
            const entryPrice = entry ? entry.entryPrice : 0;
            const stopPrice = entry ? entry.stopPrice : 0;
            const riskPts = stopPrice && entryPrice ? Math.abs(entryPrice - stopPrice) : Math.abs(pts);
            const ppt = 50; // ES contract ($50/pt) — Discord trades are ES
            const dollarPL = pts * ppt;
            const riskDollars = riskPts * ppt;

            completed.push({
                tradeNum,
                datetime: entry ? entry.datetime : currentDatetime,
                date: entry ? entry.date : currentDate,
                direction: entry ? entry.direction : 'Unknown',
                entryPrice,
                stopPrice,
                trailingProfit: entry && entry.trailingProfit != null ? entry.trailingProfit : '—',
                pointsPL: pts,
                riskPoints: riskPts,
                dollarPL,
                riskDollars,
                isWin: pts > 0,
                outcome: pts > 0 ? 'Win' : 'Loss',
                product: 'ES',
                ppt: 50,
                source: 'discord'
            });
            delete pending[tradeNum];
            continue;
        }

        // Is this an "exit" marker? (just sets a flag, result line follows)
        if (/^exit$/i.test(body)) continue;

        // Stop-limit update: "sl 7153" / "sl7153" / "stp 7153" / "stop 7153"
        // Trailing profit update: "tp 7100" / "tp7100"
        // Both adjust the pending trade in place; the final result line consumes them.
        const adjustMatch = body.match(/^(sl|stp|stop|tp|trail|trailing)\s*(\d+\.?\d*)$/i);
        if (adjustMatch) {
            const kind = adjustMatch[1].toLowerCase();
            const price = parseFloat(adjustMatch[2]);
            const entry = pending[tradeNum];
            if (!entry) continue;  // adjustment without a known entry — ignore
            if (kind === 'tp' || kind === 'trail' || kind === 'trailing') {
                entry.trailingProfit = price;
            } else {
                entry.stopPrice = price;   // sl / stp / stop all mean stop-loss
            }
            continue;
        }

        // Is this an entry line? e.g. "s 6837.5", "sell 7153 stp 7156", "b 6992", "buy 6855"
        const entryMatch = body.match(/^(s|sell|b|buy)\s+(\d+\.?\d*)\s*(?:stp\s+(\d+\.?\d*))?$/i);
        if (entryMatch) {
            const dirRaw = entryMatch[1].toLowerCase();
            const direction = (dirRaw === 's' || dirRaw === 'sell') ? 'Sell' : 'Buy';
            const entryPrice = parseFloat(entryMatch[2]);
            const stopPrice = entryMatch[3] ? parseFloat(entryMatch[3]) : 0;

            pending[tradeNum] = { direction, entryPrice, stopPrice, datetime: currentDatetime, date: currentDate };
            continue;
        }
    }

    return completed;
}

// =====================================================
// DISCORD HTML EXPORT → flat text
// =====================================================
// DiscordChatExporter (and similar tools) emit chat history as HTML where
// each message is an <li>. Each li has a `.time` span and a content <p>.
// Converting that to the same text format my plain-text Discord parser
// already understands lets both code paths share a single parser.
//
//   <li>
//     <p class="timeInfo">
//       <span class="chatName">user</span>
//       <span class="time">Tue Apr 21 2026 13:06:01 GMT-0500 (...)</span>
//     </p>
//     <p>... message content (multi-line) ...</p>
//   </li>
//
// Output line shape (one per message): "M/D/YYYY h:mm AM/PM\n<content>".
// Pure regex — works in browsers and Node alike, no DOMParser needed.

function htmlToDiscordText(html) {
    if (typeof html !== 'string' || html.length === 0) return '';
    const liRegex = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
    const out = [];
    let lim;
    while ((lim = liRegex.exec(html)) !== null) {
        const li = lim[1];
        const timeMatch = li.match(/<span\s+class\s*=\s*["']time["'][^>]*>([\s\S]*?)<\/span>/i);
        const tsRaw = timeMatch ? timeMatch[1].trim() : '';

        // Pull every <p>; the timeInfo <p> is index 0, content is index 1+.
        const pRegex = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
        const ps = [];
        let pm;
        while ((pm = pRegex.exec(li)) !== null) ps.push(pm[1]);
        if (ps.length < 2) continue;

        const contentHtml = ps.slice(1).join('\n');
        const content = contentHtml
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]+>/g, '')        // strip tags
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .trim();
        if (!content) continue;

        if (tsRaw) {
            // Strip the trailing TZ name in parentheses; new Date() handles the rest.
            const cleaned = tsRaw.replace(/\s*\(.*\)\s*$/, '');
            const d = new Date(cleaned);
            if (!isNaN(d.getTime())) {
                const mo = d.getMonth() + 1;
                const day = d.getDate();
                const y = d.getFullYear();
                let h = d.getHours();
                const min = String(d.getMinutes()).padStart(2, '0');
                const ampm = h >= 12 ? 'PM' : 'AM';
                if (h === 0) h = 12;
                else if (h > 12) h -= 12;
                out.push(`${mo}/${day}/${y} ${h}:${min} ${ampm}`);
            }
        }
        out.push(content);
    }
    return out.join('\n');
}

// Convenience wrappers that route HTML through the existing text parsers.
function parseDiscordOptionsHTML(html) {
    return parseDiscordOptionsText(htmlToDiscordText(html));
}
function parseDiscordTradeHTML(html) {
    return parseDiscordTradeText(htmlToDiscordText(html));
}

// Cheap content sniffer — used by admin/upload flows to decide between
// the HTML and plain-text parsers without forcing the operator to pick.
function looksLikeDiscordHTML(text) {
    if (typeof text !== 'string' || text.length === 0) return false;
    return /<li\b[\s\S]*?class\s*=\s*["']time["']/i.test(text)
        || /chatContent/i.test(text);
}

// =====================================================
// DISCORD OPTIONS ALERT PARSER
// =====================================================
// Parses multi-line Discord options alerts in the Ekantik format:
//
//   ID: 11
//   Ticker: SPX
//   Type: buy put
//   Strike: 7090
//   Expiry: ODTE
//   Entry: 5.6
//   Stop price: 4
//   Default: -2 points
//   ID 11: +800
//
// Entry is a multi-line block keyed on "ID: <n>". The result line is
// "ID <n>: <+/-$>". Date dividers and per-message timestamps are handled
// the same way as the futures parser (see parseDiscordTradeText).
//
// Returns snake_case objects matching the options_trades.json schema.

const OPTIONS_CONTRACT_MULTIPLIER = 100;  // standard equity-option multiplier

function parseDiscordOptionsText(text) {
    const lines = text.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const pending = {};
    const completed = [];
    let current = null;           // trade being accumulated
    let currentDate = '';
    let currentDatetime = '';

    const finishTrade = (t, dollarPL) => {
        const entry = t._entry_price || 0;
        const stop  = t._stop_price  || 0;
        let riskDollars;
        if (stop > 0 && entry > 0) {
            riskDollars = Math.abs(entry - stop) * OPTIONS_CONTRACT_MULTIPLIER;
        } else if (t._default_points != null) {
            riskDollars = Math.abs(t._default_points) * OPTIONS_CONTRACT_MULTIPLIER;
        } else if (t._all_in && entry > 0) {
            // "Default: all in" — risk is the full premium paid.
            riskDollars = entry * OPTIONS_CONTRACT_MULTIPLIER;
        } else {
            riskDollars = 0;
        }
        // Round to 2 decimals — kills floating-point artifacts like 159.9999999.
        riskDollars = Math.round(riskDollars * 100) / 100;
        return {
            datetime:    t._datetime || '',
            entry_time:  t._datetime || '',
            exit_time:   '',
            trade_num:   'O' + t._id,
            ticker:      t._ticker || '',
            option_type: t._option_type || '',
            strike:      t._strike != null ? t._strike : 0,
            expiry:      t._expiry || '',
            direction:   t._direction || 'Buy',
            entry_price: entry,
            stop_price:  stop,
            notes:       t._notes || '',
            dollar_pl:   dollarPL,
            risk_dollars: riskDollars,
            is_win:      dollarPL > 0,
            outcome:     dollarPL > 0 ? 'Win' : 'Loss',
            trade_date:  t._trade_date || '',
            source:      'discord'
        };
    };

    for (const raw of lines) {
        const line = raw;

        // 1. Date divider: "— April 14, 2026 —" or "April 14, 2026"
        const dividerMatch = line.match(/^—?\s*(\w+)\s+(\d{1,2}),?\s+(\d{4})\s*—?$/);
        if (dividerMatch) {
            const monthNum = MONTH_NAMES[dividerMatch[1].toLowerCase()];
            if (monthNum) {
                const day = parseInt(dividerMatch[2]);
                const year = parseInt(dividerMatch[3]);
                currentDate = `${monthNum}/${day}/${year}`;
                currentDatetime = `${year}-${String(monthNum).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            }
            continue;
        }

        // 2. Date+time header: "Ekantik Capital  4/13/2026 8:33 AM" or bare slash-date.
        const headerMatch = line.match(/(?:^|\s)(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)/i);
        if (headerMatch && !/^ID\b/i.test(line)) {
            const dp = headerMatch[1].split('/');
            const month = parseInt(dp[0]), day = parseInt(dp[1]), year = parseInt(dp[2]);
            currentDate = `${month}/${day}/${year}`;
            currentDatetime = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${headerMatch[2].trim()}`;
            continue;
        }

        // 3. Result line: "ID 11: +800" / "ID 11: +$800" / "ID 11: +220$" / "ID 11: -100$"
        // Dollar sign tolerated on either side of the number, optional sign defaults to +.
        const resultMatch = line.match(/^ID\s+(\d+)\s*:\s*([+-]?)\s*\$?\s*(\d+\.?\d*)\s*\$?\s*$/i);
        if (resultMatch) {
            const id = resultMatch[1];
            const sign = resultMatch[2] === '-' ? -1 : 1;
            const dollars = parseFloat(resultMatch[3]) * sign;

            if (current && current._id === id) {
                completed.push(finishTrade(current, dollars));
                current = null;
                continue;
            }
            if (pending[id]) {
                completed.push(finishTrade(pending[id], dollars));
                delete pending[id];
                continue;
            }
            // Result arrived without a known entry — skip silently
            continue;
        }

        // 4. Key-value line: "Ticker: SPX" / "Entry: 5.6" / etc.
        const kv = line.match(/^([A-Za-z][A-Za-z\s]*?)\s*:\s*(.+?)\s*$/);
        if (!kv) continue;
        const key = kv[1].toLowerCase().replace(/\s+/g, ' ').trim();
        const val = kv[2].trim();

        if (key === 'id') {
            if (current && current._id) pending[current._id] = current;
            current = {
                _id: val.replace(/[^0-9]/g, ''),
                _datetime: currentDatetime,
                _trade_date: currentDate
            };
            continue;
        }
        if (!current) continue;

        switch (key) {
            case 'ticker':
                current._ticker = val.toUpperCase();
                break;
            case 'type': {
                const parts = val.toLowerCase().split(/\s+/);
                if (parts.includes('sell') || parts.includes('short')) current._direction = 'Sell';
                else current._direction = 'Buy';
                if (parts.includes('put'))  current._option_type = 'PUT';
                else if (parts.includes('call')) current._option_type = 'CALL';
                break;
            }
            case 'strike': {
                const n = parseFloat(val.replace(/[^0-9.]/g, ''));
                if (!isNaN(n)) current._strike = n;
                break;
            }
            case 'expiry':
                current._expiry = val;
                break;
            case 'entry':
            case 'entry price': {
                const n = parseFloat(val.replace(/[^0-9.-]/g, ''));
                if (!isNaN(n)) current._entry_price = n;
                break;
            }
            case 'stop':
            case 'stop price': {
                const n = parseFloat(val.replace(/[^0-9.-]/g, ''));
                if (!isNaN(n)) current._stop_price = n;
                break;
            }
            case 'default': {
                if (/all\s*in/i.test(val)) {
                    current._all_in = true;
                } else {
                    const m = val.match(/(-?\d+\.?\d*)\s*(?:points?|pts?)?/i);
                    if (m) current._default_points = parseFloat(m[1]);
                }
                break;
            }
            case 'notes':
            case 'note':
                current._notes = val;
                break;
            // Unknown keys — ignore
        }
    }

    // Flush any started-but-unfinished entries into pending (no result yet).
    // We DO NOT emit half-trades — callers get only closed fills — but we
    // attach the pending count + ID list as properties so the admin UI can
    // tell the user "you have entries but no close line."
    if (current && current._id) pending[current._id] = current;
    const pendingIds = Object.keys(pending).map(id => 'O' + id);
    completed.pending = pendingIds;

    return completed;
}

// Parse the discord_trades.json format (array of trade objects)
function parseDiscordJSON(jsonArray) {
    if (!Array.isArray(jsonArray)) return [];
    return jsonArray.map(t => {
        const date = t.date || '';
        return {
            tradeNum: t.tradeNum || '',
            datetime: t.datetime || '',
            date: normalizeDate(date),
            direction: (t.direction || '').charAt(0).toUpperCase() + (t.direction || '').slice(1).toLowerCase(),
            entryPrice: t.entryPrice || 0,
            stopPrice: t.stopPrice || 0,
            trailingProfit: t.trailingProfit || '—',
            pointsPL: t.pointsPL || 0,
            riskPoints: t.riskPoints || Math.abs(t.pointsPL || 0),
            dollarPL: t.dollarPL || 0,
            riskDollars: t.riskDollars || 0,
            isWin: t.isWin !== undefined ? t.isWin : (t.pointsPL > 0),
            outcome: t.outcome || (t.pointsPL > 0 ? 'Win' : 'Loss'),
            product: 'ES',
            ppt: 50,
            source: 'discord'
        };
    });
}

// ===== SETUP QUALITY MEASUREMENT PROTOCOL v3.0 =====
// Four binary rules per trade. All must pass for setup-valid.
// See /methodology for full documentation.

function parseTradeTimestamp(trade) {
    // Try datetime first, then entryTime, then construct from date
    const raw = trade.datetime || trade.entryTime || '';
    if (!raw) return null;

    // Handle "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DD HH:MM AM/PM"
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
        const d = new Date(raw.replace(' ', 'T'));
        if (!isNaN(d.getTime())) return d;
    }

    // Handle "M/D/YYYY H:MM AM/PM" or "M/D/YYYY HH:MM"
    const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(.+)$/);
    if (m) {
        const d = new Date(`${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}T${convertTo24h(m[4])}`);
        if (!isNaN(d.getTime())) return d;
    }

    return null;
}

function convertTo24h(timeStr) {
    const m = timeStr.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
    if (!m) return '00:00:00';
    let h = parseInt(m[1]), min = m[2], sec = m[3] || '00';
    const ampm = (m[4] || '').toUpperCase();
    if (ampm === 'PM' && h < 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    return `${String(h).padStart(2,'0')}:${min}:${sec}`;
}

// =====================================================
// OBSERVED MONTHLY RATE — Geometric mean from cumulative return
// Powers the dual doubling ladder on the main page
// =====================================================
function computeObservedMonthlyRate(trades) {
    const DAYS_PER_MONTH = 30.4375; // 365.25 / 12
    const TARGET_RATE = 0.025; // 2.5% monthly
    const MIN_SAMPLE = 10;
    const MULTIPLES = [
        { key: '20k', multiple: 2 },
        { key: '40k', multiple: 4 },
        { key: '80k', multiple: 8 },
        { key: '100k', multiple: 10 },
        { key: '1m', multiple: 100 }
    ];

    if (!trades || trades.length === 0) {
        return { sampleBelowMinimum: true, tradeCount: 0 };
    }

    // Sort chronologically
    const sorted = [...trades].sort((a, b) => {
        const da = parseTradeTimestamp(a), db = parseTradeTimestamp(b);
        if (da && db) return da - db;
        return 0;
    });

    const N = sorted.length;
    const cumPL = sorted.reduce((s, t) => s + (t.dollarPL || 0), 0);
    const startingEquity = TENX_STARTING_BALANCE;
    const endingEquity = startingEquity + cumPL;
    const cumReturn = cumPL / startingEquity;

    // Calendar months elapsed
    const firstTime = parseTradeTimestamp(sorted[0]);
    const lastTime = parseTradeTimestamp(sorted[N - 1]);
    let monthsElapsed = 0;
    if (firstTime && lastTime && lastTime > firstTime) {
        const daysElapsed = (lastTime - firstTime) / (1000 * 60 * 60 * 24);
        monthsElapsed = daysElapsed / DAYS_PER_MONTH;
    }

    // Sample size guard
    if (N < MIN_SAMPLE) {
        return {
            sampleBelowMinimum: true,
            tradeCount: N,
            minRequired: MIN_SAMPLE
        };
    }

    // Guard: zero or near-zero time span
    if (monthsElapsed < 0.1) {
        return {
            sampleBelowMinimum: false,
            tradeCount: N,
            rateNegative: cumReturn <= 0,
            rateBelowTarget: true,
            observedRate: 0,
            observedRatePct: '0.00',
            monthsElapsed,
            cumReturn,
            ladderMonths: null
        };
    }

    // Geometric mean monthly rate
    let observedRate;
    let rateNegative = false;

    if (cumReturn <= 0) {
        rateNegative = true;
        observedRate = cumReturn <= -1 ? -1 : (Math.pow(1 + cumReturn, 1 / monthsElapsed) - 1);
    } else {
        observedRate = Math.pow(1 + cumReturn, 1 / monthsElapsed) - 1;
    }

    // Ladder months at each rung
    let ladderMonths = null;
    if (observedRate > 0) {
        ladderMonths = {};
        for (const { key, multiple } of MULTIPLES) {
            ladderMonths[key] = Math.round(Math.log(multiple) / Math.log(1 + observedRate) * 10) / 10;
        }
    }

    return {
        sampleBelowMinimum: false,
        tradeCount: N,
        observedRate,
        observedRatePct: (observedRate * 100).toFixed(2),
        monthsElapsed: Math.round(monthsElapsed * 100) / 100,
        cumReturn,
        cumReturnPct: (cumReturn * 100).toFixed(1),
        rateNegative,
        rateBelowTarget: observedRate < TARGET_RATE,
        ladderMonths
    };
}

function computeSetupQuality(trades) {
    if (!trades || trades.length === 0) return { trades: [], setupQualityPct: 0, validCount: 0, totalCount: 0 };

    // Sort chronologically (safety measure)
    const sorted = [...trades].sort((a, b) => {
        const da = parseTradeTimestamp(a), db = parseTradeTimestamp(b);
        if (da && db) return da - db;
        // Fallback to date string comparison
        const na = normalizeDate(a.date || ''), nb = normalizeDate(b.date || '');
        return na.localeCompare(nb);
    });

    let cumPL = 0;
    let validCount = 0;
    let forwardValid = 0;
    let forwardTotal = 0;
    const startDate = SETUP_QUALITY_START_DATE; // 'YYYY-MM-DD'
    const enriched = [];

    for (let i = 0; i < sorted.length; i++) {
        const t = { ...sorted[i] };
        const equityBefore = TENX_STARTING_BALANCE + cumPL;
        t.equity_before = equityBefore;

        const ppt = PPT_BY_PRODUCT[t.product] || t.ppt || 50;
        const contracts = t.contracts || 1;

        // ── Rule 1: Max Loss Per Trade 2-3% ──
        // Use stop price if available, otherwise derive from riskPoints, default 10 pts
        let riskDollarsR1;
        if (t.stopPrice && t.stopPrice > 0 && t.entryPrice > 0) {
            riskDollarsR1 = Math.abs(t.entryPrice - t.stopPrice) * contracts * ppt;
        } else {
            // Default stop = 10 points when not explicitly set
            const riskPts = t.riskPoints || 10;
            riskDollarsR1 = riskPts * ppt * contracts;
        }
        t.risk_pct = riskDollarsR1 / equityBefore;
        t.r1_pass = t.risk_pct >= 0.02 && t.risk_pct <= 0.03;

        // ── Rule 2: Min Profit on Winners ≥1% ──
        if (t.dollarPL <= 0) {
            // Losers/breakeven: auto-pass (rule does not apply)
            t.r2_pass = true;
            t.r2_na = true;
        } else {
            const profitPct = t.dollarPL / equityBefore;
            t.realized_profit_pct = profitPct;
            t.r2_pass = profitPct >= 0.01;
            t.r2_na = false;
        }

        // ── Rule 3: Max 1 Loser/Day + 30-min Cooldown After Win ──
        // Two sub-rules:
        //   3a. Only 1 losing trade per day — if a loss already occurred today, FAIL
        //   3b. 30-min cooldown after a winning trade
        t.r3_pass = true;
        t.r3_reason = null;
        const currTradeDate = normalizeDate(t.date || '');

        // 3a: Count losses already closed today before this trade
        let dailyLosses = 0;
        for (let j = 0; j < i; j++) {
            const prior = enriched[j];
            if (prior.dollarPL < 0 && normalizeDate(prior.date || '') === currTradeDate) {
                dailyLosses++;
            }
        }
        if (dailyLosses >= 1) {
            // A loss already occurred today — no more trades allowed
            t.r3_pass = false;
            t.r3_reason = `${dailyLosses} loss(es) already today`;
        }

        // 3b: 30-min cooldown after previous winning trade
        if (i > 0 && t.r3_pass) {
            const prev = enriched[i - 1];
            if (prev.dollarPL > 0) {
                const prevTime = parseTradeTimestamp(prev);
                const currTime = parseTradeTimestamp(t);
                if (prevTime && currTime) {
                    const elapsedMin = (currTime - prevTime) / (1000 * 60);
                    t.minutes_since_last_trade = Math.round(elapsedMin);
                    if (elapsedMin < 30) {
                        t.r3_pass = false;
                        t.r3_reason = `${Math.round(elapsedMin)}min after win (need 30)`;
                    }
                }
            }
        }

        // ── Rule 4: Aggregate Limits Intact at Entry ──
        const tradeDate = normalizeDate(t.date || '');
        const tradeWeek = t.date ? getWeekKey(t.date) : '';

        let dailyLoss = 0, weeklyLoss = 0;
        for (let j = 0; j < i; j++) {
            const prior = enriched[j];
            if (prior.dollarPL < 0) {
                const priorDate = normalizeDate(prior.date || '');
                const priorWeek = prior.date ? getWeekKey(prior.date) : '';
                if (priorDate === tradeDate) dailyLoss += prior.dollarPL;
                if (priorWeek === tradeWeek) weeklyLoss += prior.dollarPL;
            }
        }
        const dailyLossPct = Math.abs(dailyLoss) / equityBefore;
        const weeklyLossPct = Math.abs(weeklyLoss) / equityBefore;
        t.daily_loss_pct = dailyLossPct;
        t.weekly_loss_pct = weeklyLossPct;
        t.r4_pass = dailyLossPct < 0.05 && weeklyLossPct < 0.10;

        // ── Composite ──
        t.setup_valid = t.r1_pass && t.r2_pass && t.r3_pass && t.r4_pass;
        if (t.setup_valid) validCount++;

        // Determine if this trade counts toward the forward aggregate
        // Compare using Date objects to avoid format mismatch (normalizeDate returns M/D/YYYY, startDate is YYYY-MM-DD)
        const tDateObj = parseTradeTimestamp(t) || new Date(t.date || '');
        const startDateObj = new Date(startDate + 'T00:00:00');
        t.is_forward = tDateObj instanceof Date && !isNaN(tDateObj) && tDateObj >= startDateObj;
        if (t.is_forward) {
            forwardTotal++;
            if (t.setup_valid) forwardValid++;
        }

        cumPL += t.dollarPL;
        enriched.push(t);
    }

    // Scorecard % uses ONLY forward trades (post-adoption)
    // If no forward trades yet, show '—' via 0/0
    return {
        trades: enriched,
        setupQualityPct: forwardTotal > 0 ? (forwardValid / forwardTotal) * 100 : null,
        validCount: forwardValid,
        totalCount: forwardTotal,
        // Keep all-time stats available for diagnostics
        allTimeValid: validCount,
        allTimeTotal: enriched.length
    };
}

function buildSetupTooltip(t) {
    const rules = [];
    if (t.r1_pass === false) rules.push('R1: Risk outside 2-3%');
    if (t.r2_pass === false && !t.r2_na) rules.push('R2: Winner profit <1%');
    if (t.r3_pass === false) rules.push(`R3: ${t.r3_reason || '1 loser/day or 30min cooldown'}`);
    if (t.r4_pass === false) rules.push('R4: Aggregate limit breached');
    return rules.join(' | ') || 'Setup invalid';
}

// ===== KPI CALCULATOR =====
function calculateKPIs(trades, riskBudget, pointMultiplier, startingBalance = TENX_STARTING_BALANCE) {
    if (!trades || trades.length === 0) return null;

    const totalTrades = trades.length;
    const wins = trades.filter(t => t.isWin);
    const losses = trades.filter(t => !t.isWin);
    const winCount = wins.length;
    const lossCount = losses.length;

    const netPL = trades.reduce((s, t) => s + t.dollarPL, 0);
    const netPoints = trades.reduce((s, t) => s + t.pointsPL, 0);
    const grossWins = wins.reduce((s, t) => s + t.dollarPL, 0);
    const grossLosses = Math.abs(losses.reduce((s, t) => s + t.dollarPL, 0));

    const winRate = (winCount / totalTrades * 100);
    const profitFactor = grossLosses > 0 ? grossWins / grossLosses : Infinity;
    const returnPct = (netPL / startingBalance * 100);

    // EV
    const evPerTrade = netPL / totalTrades;
    const evPlannedR = (evPerTrade / riskBudget * 100);

    // Avg win/loss
    const avgWinDollar = winCount > 0 ? grossWins / winCount : 0;
    const avgLossDollar = lossCount > 0 ? -grossLosses / lossCount : 0;
    const avgWinPts = winCount > 0 ? wins.reduce((s, t) => s + t.pointsPL, 0) / winCount : 0;
    const avgLossPts = lossCount > 0 ? losses.reduce((s, t) => s + t.pointsPL, 0) / lossCount : 0;
    const wlRatio = Math.abs(avgLossDollar) > 0 ? avgWinDollar / Math.abs(avgLossDollar) : Infinity;
    const expectancyR = (winRate / 100 * wlRatio) - (lossCount / totalTrades);

    // Risk metrics (from actual stops)
    const tradesWithRisk = trades.filter(t => t.riskDollars > 0);
    const avgRiskDollars = tradesWithRisk.length > 0 ? tradesWithRisk.reduce((s, t) => s + t.riskDollars, 0) / tradesWithRisk.length : riskBudget;
    const maxRiskDollars = tradesWithRisk.length > 0 ? Math.max(...tradesWithRisk.map(t => t.riskDollars)) : 0;
    const evActualR = avgRiskDollars > 0 ? (evPerTrade / avgRiskDollars * 100) : 0;
    const riskAdherence = tradesWithRisk.length > 0 ? tradesWithRisk.filter(t => t.riskDollars <= riskBudget * 1.2).length / tradesWithRisk.length * 100 : 0;

    // Avg R:R for winners and losers
    const winsWithRR = wins.filter(t => t.rewardRisk !== null && t.rewardRisk !== undefined);
    const lossesWithRR = losses.filter(t => t.rewardRisk !== null && t.rewardRisk !== undefined);
    const avgRRWins = winsWithRR.length > 0 ? winsWithRR.reduce((s, t) => s + t.rewardRisk, 0) / winsWithRR.length : 0;
    const avgRRLosses = lossesWithRR.length > 0 ? lossesWithRR.reduce((s, t) => s + t.rewardRisk, 0) / lossesWithRR.length : 0;

    // Avg loss cut level
    const lossesWithRisk = losses.filter(t => t.riskDollars > 0);
    const avgLossCut = lossesWithRisk.length > 0 ? lossesWithRisk.reduce((s, t) => s + (Math.abs(t.dollarPL) / t.riskDollars), 0) / lossesWithRisk.length : 0;

    // Drawdown
    let cumPL = 0, peak = 0, maxDD = 0, currentDD = 0;
    const equityCurve = [];
    const drawdownCurve = [];

    trades.forEach(t => {
        cumPL += t.dollarPL;
        if (cumPL > peak) peak = cumPL;
        const dd = peak - cumPL;
        if (dd > maxDD) maxDD = dd;
        equityCurve.push({ time: t.exitTime || t.datetime, cumPL, balance: startingBalance + cumPL });
        drawdownCurve.push({ time: t.exitTime || t.datetime, dd: -(peak - cumPL) });
    });
    currentDD = peak - cumPL;

    const maxDDPct = peak > 0 ? (maxDD / (startingBalance + peak) * 100) : (maxDD / startingBalance * 100);
    const recoveryFactor = maxDD > 0 ? netPL / maxDD : Infinity;

    // Streaks
    let maxCW = 0, maxCL = 0, cw = 0, cl = 0, streak = 0;
    trades.forEach(t => {
        if (t.isWin) { cw++; cl = 0; if (cw > maxCW) maxCW = cw; }
        else { cl++; cw = 0; if (cl > maxCL) maxCL = cl; }
    });
    for (let i = trades.length - 1; i >= 0; i--) {
        if (i === trades.length - 1) streak = trades[i].isWin ? 1 : -1;
        else if (trades[i].isWin && streak > 0) streak++;
        else if (!trades[i].isWin && streak < 0) streak--;
        else break;
    }

    // Daily P&L
    const dailyPL = {};
    trades.forEach(t => {
        const d = t.date;
        if (!dailyPL[d]) dailyPL[d] = { pl: 0, trades: 0, wins: 0 };
        dailyPL[d].pl += t.dollarPL;
        dailyPL[d].trades++;
        if (t.isWin) dailyPL[d].wins++;
    });
    const tradingDays = Object.keys(dailyPL).sort();
    const profitableDays = tradingDays.filter(d => dailyPL[d].pl > 0).length;

    // Weekly P&L
    const weeklyPL = {};
    trades.forEach(t => {
        const wk = getWeekKey(t.date);
        if (!weeklyPL[wk]) weeklyPL[wk] = { pl: 0, trades: [], startDate: t.date, wins: 0, losses: 0 };
        weeklyPL[wk].pl += t.dollarPL;
        weeklyPL[wk].trades.push(t);
        if (t.isWin) weeklyPL[wk].wins++;
        else weeklyPL[wk].losses++;
    });

    // Long/Short
    const longs = trades.filter(t => t.direction === 'Long' || (t.direction && t.direction.toLowerCase().includes('buy')));
    const shorts = trades.filter(t => t.direction === 'Short' || (t.direction && t.direction.toLowerCase().includes('sell')));

    // Risk distribution
    const riskBrackets = [0, 25, 50, 75, 100, 125, 150, 200, 300, Infinity];
    const riskDist = [];
    for (let i = 0; i < riskBrackets.length - 1; i++) {
        const count = tradesWithRisk.filter(t => t.riskDollars >= riskBrackets[i] && t.riskDollars < riskBrackets[i + 1]).length;
        if (count > 0) {
            riskDist.push({
                label: riskBrackets[i + 1] === Infinity ? `$${riskBrackets[i]}+` : `$${riskBrackets[i]}–$${riskBrackets[i + 1]}`,
                count,
                pct: (count / tradesWithRisk.length * 100)
            });
        }
    }

    // Win/Loss $ distribution for histogram
    const plDistribution = trades.map(t => t.dollarPL);

    return {
        totalTrades, winCount, lossCount, winRate, netPL, netPoints, grossWins, grossLosses,
        profitFactor, returnPct,
        evPerTrade, evPlannedR, evActualR, avgRiskDollars, maxRiskDollars, riskAdherence,
        avgWinDollar, avgLossDollar, avgWinPts, avgLossPts, wlRatio, expectancyR,
        avgRRWins, avgRRLosses, avgLossCut,
        maxDD, maxDDPct, currentDD, recoveryFactor,
        maxCW, maxCL, streak,
        equityCurve, drawdownCurve, dailyPL, weeklyPL, tradingDays, profitableDays,
        longs, shorts, riskDist, plDistribution,
        bestTrade: Math.max(...trades.map(t => t.dollarPL)),
        worstTrade: Math.min(...trades.map(t => t.dollarPL)),
        profitPerDay: netPL / tradingDays.length,
        tradesPerDay: totalTrades / tradingDays.length
    };
}

// ===== WEEKLY SNAPSHOT GENERATOR =====
function generateWeeklySnapshots(trades, method, riskBudget, ppt, startingBalance = TENX_STARTING_BALANCE) {
    const weeklyPL = {};
    trades.forEach(t => {
        const wk = getWeekKey(t.date);
        if (!weeklyPL[wk]) weeklyPL[wk] = [];
        weeklyPL[wk].push(t);
    });

    const weeks = Object.keys(weeklyPL).sort((a, b) => parseWeekKey(a) - parseWeekKey(b));
    let cumPL = 0;
    const snapshots = [];

    for (const wk of weeks) {
        const wkTrades = weeklyPL[wk];
        const wkKPIs = calculateKPIs(wkTrades, riskBudget, ppt, startingBalance);
        cumPL += wkKPIs.netPL;

        snapshots.push({
            method,
            week_key: wk,
            net_pl: wkKPIs.netPL,
            net_points: wkKPIs.netPoints,
            return_pct: wkKPIs.returnPct,
            total_trades: wkKPIs.totalTrades,
            win_count: wkKPIs.winCount,
            loss_count: wkKPIs.lossCount,
            win_rate: wkKPIs.winRate,
            profit_factor: wkKPIs.profitFactor === Infinity ? 999 : wkKPIs.profitFactor,
            ev_planned_r: wkKPIs.evPlannedR,
            ev_actual_r: wkKPIs.evActualR,
            max_dd: wkKPIs.maxDD,
            cumulative_pl: cumPL,
            cumulative_balance: startingBalance + cumPL,
            cumulative_return: (cumPL / startingBalance * 100)
        });
    }

    return snapshots;
}

// ===== WEEK HELPERS =====
function getWeekKey(dateStr) {
    const normalized = normalizeDate(dateStr);
    let d;
    if (normalized.includes('/')) {
        const parts = normalized.split('/');
        if (parts[2] && parts[2].length === 2) parts[2] = '20' + parts[2];
        d = new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
    } else {
        d = new Date(normalized);
    }
    if (isNaN(d.getTime())) return '';
    const dow = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((dow + 6) % 7));
    return `${(monday.getMonth() + 1).toString().padStart(2, '0')}/${monday.getDate().toString().padStart(2, '0')}/${monday.getFullYear()}`;
}

function getWeekRange(weekKey) {
    const parts = weekKey.split('/');
    const monday = new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);
    const opts = { month: 'short', day: 'numeric' };
    return `${monday.toLocaleDateString('en-US', opts)} – ${friday.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`;
}

function getWeeksList(trades) {
    const weeks = new Set();
    trades.forEach(t => {
        const wk = getWeekKey(t.date);
        if (wk) weeks.add(wk);
    });
    return [...weeks].sort((a, b) => parseWeekKey(a) - parseWeekKey(b)).reverse();
}

function filterByWeek(trades, weekKey) {
    return trades.filter(t => getWeekKey(t.date) === weekKey);
}

function filterByMonth(trades, weekKey) {
    const parts = weekKey.split('/');
    const targetMonth = parseInt(parts[0]);
    const targetYear = parseInt(parts[2]);
    return trades.filter(t => {
        const normalized = normalizeDate(t.date);
        const dp = normalized.split('/');
        const m = parseInt(dp[0]);
        const y = dp[2] ? parseInt(dp[2].length === 2 ? '20' + dp[2] : dp[2]) : targetYear;
        return m === targetMonth && y === targetYear;
    });
}

function getMonthKey(dateStr) {
    const parts = dateStr.split('/');
    const m = parseInt(parts[0]);
    const y = parts[2] ? (parts[2].length === 2 ? '20' + parts[2] : parts[2]) : '2026';
    return `${String(m).padStart(2, '0')}/${y}`;
}

function getMonthsList(trades) {
    const months = new Set();
    trades.forEach(t => months.add(getMonthKey(t.date)));
    return [...months].sort().reverse();
}
