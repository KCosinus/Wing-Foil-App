require('dotenv').config();
const axios = require('axios');
const ms2kn = 1.943844;
const stationApi = 'https://api.openmeteo.com/observations/openmeteo/1001';

async function getRaw(path) {
    try {
        const { data, headers } = await axios.get(`${stationApi}/${path}`, { timeout: 12000, validateStatus: () => true });
        return { ok: true, path, status: headers[':status'] ?? '?', ct: headers['content-type'], data };
    } catch (e) {
        return { ok: false, path, err: e.response?.data || e.message };
    }
}

function prettySensor(name, data) {
    if (!Array.isArray(data)) {
        return `  ${name} → KEIN Array! (${typeof data}) ${JSON.stringify(data).slice(0,200)}`;
    }
    const lines = [`  ✅ ${name} – Array Länge ${data.length}`];
    if (typeof data[0] === 'number' && data[0] > 1_700_000_000) {
        const ts = new Date(data[0] * 1000);
        const age = Math.round((Date.now() - data[0] * 1000) / 60000);
        lines.push(`     [0] ts = ${data[0]}  →  ${ts.toISOString().replace('T',' ').slice(0,19)} UTC  (Alter: ${age} Min)`);
        data.slice(1).forEach((v,i) => {
            const lbl =
                (name.startsWith('wind') && i === 0 ? '  (Index 1 → Vermutlich Richtung?)  ' : '') +
                (name.startsWith('wind') && i === 1 ? '  (Index 2 → Vermutlich Böen?)        ' : '') +
                (name.startsWith('wind') && i === 2 ? '  (Index 3 → Vermutlich Speed?)       ' : '');
            lines.push(`     [${i+1}] = ${v}${lbl}`);
        });
    } else if (data.length > 2 && Array.isArray(data[0])) {
        // Zweidimensional: vermutlich Zeitreihe (Aggregat-Endpunkt)
        lines.push(`     Ist 2D-Array (Zeitreihe, ${data.length} Punkte!)`);
        // Die letzten 6 Punkte zeigen
        data.slice(Math.max(0, data.length - 6)).forEach(row => {
            const ts = new Date(row[0] * 1000);
            const vals = row.slice(1).map((x, idx) => `[${idx+1}]=${x}`).join(' ');
            lines.push(`       ${ts.toISOString().replace('T',' ').slice(0,16)} →  ${vals}`);
        });
    } else {
        lines.push(`     ${data.map((v,i)=>`[${i}]=${v}`).join('  ')}`);
    }
    return lines.join('\n');
}

(async () => {
    // 1) Alle verfügbaren Sensoren laut Location-Seite einzeln prüfen
    const sensors = ['wind0', 'wind1', 't2', 't7', 'th0', 'th1', 'th4', 'th5', 'baro0', 'baro1', 'rain0'];
    console.log('===== 1) Einzelne Sensor-Endpunkte /<sensor> =====');
    for (const s of sensors) {
        const r = await getRaw(s);
        if (!r.ok) { console.log(`  ❌ ${s}: ${r.err}`); continue; }
        console.log(prettySensor(s, r.data));
    }

    // 2) Aggregat-Endpunkte wie im Location-HTML
    const aggs = [
        'wind0/last24h/avg15m',
        'wind1/last24h/avg15m',
        'wind0/20260922',
        'wind1/20260922',
        'baro0/last24h',
        't2/last4w',
        'th1/last24h'
    ];
    console.log('\n===== 2) Aggregierte Diagramm-Endpunkte =====');
    for (const p of aggs) {
        const r = await getRaw(p);
        if (!r.ok) { console.log(`  ❌ ${p}: ${r.err}`); continue; }
        console.log(prettySensor(p, r.data));
    }

    // 3) Zusammenfassung: Welche Sensoren liefern NICHT 0 für Wind?
    console.log('\n===== 3) Wind-Sensoren Zusammenfassung =====');
    for (const s of ['wind0', 'wind1']) {
        const r = await getRaw(s);
        if (!r.ok || !Array.isArray(r.data)) continue;
        const age = Math.round((Date.now() - r.data[0] * 1000) / 60000);
        const fresh = age < 30;
        if (r.data.length >= 4) {
            const dir = r.data[1], gust_ms = r.data[2], speed_ms = r.data[3];
            console.log(`  ${s} → Alter ${age} Min, fresh=${fresh ? 'JA' : 'NEIN'}  ` +
                        `Speed=${(speed_ms*ms2kn).toFixed(1)}kn  Gust=${(gust_ms*ms2kn).toFixed(1)}kn  Dir=${dir}°`);
        }
    }
})();
