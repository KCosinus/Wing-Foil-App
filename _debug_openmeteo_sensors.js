require('dotenv').config();
const axios = require('axios');

const STATION_ID = '1001';
const stationApi = `https://api.openmeteo.com/observations/openmeteo/${STATION_ID}`;
const ms2kn = 1.943844;

async function fetchOne(name) {
    try {
        const { data } = await axios.get(`${stationApi}/${name}`, { timeout: 10000 });
        return { ok: true, name, data };
    } catch (e) {
        return { ok: false, name, err: e.response?.data || e.message };
    }
}

async function fetchLocationPage() {
    try {
        const { data } = await axios.get('https://www.openmeteo.com/location/de/cospudener-see', { timeout: 10000 });
        return data;
    } catch (e) {
        return `ERROR: ${e.message}`;
    }
}

// Aus dem Code aktuell verwendetes Mapping (Zeigen wir zum Vergleich)
function extractOldFashion(wind) {
    const ts = wind[0] * 1000;
    const fresh = Date.now() - ts < 30 * 60 * 1000;
    return {
        wind_observed_at: new Date(ts).toISOString(),
        age_min: Math.round((Date.now() - ts) / 60000),
        isFresh: fresh,
        direction: fresh ? wind[1] : null,
        gusts_ms: fresh ? wind[2] : null,
        speed_ms: fresh ? wind[3] : null,
        gusts_kn: fresh ? (wind[2] * ms2kn).toFixed(1) : null,
        speed_kn: fresh ? (wind[3] * ms2kn).toFixed(1) : null,
    };
}

(async () => {
    const sensorNames = ['wind0', 't2', 'th1', 'baro0'];
    console.log('===== 1) Sensor-Antworten (rohe Arrays) von api.openmeteo.com/observations/openmeteo/' + STATION_ID + '/<sensor> =====');
    for (const n of sensorNames) {
        const r = await fetchOne(n);
        if (!r.ok) {
            console.log(`\n  ❌ ${n}: ${r.err}`);
            continue;
        }
        console.log(`\n  ✅ ${n}`);
        if (Array.isArray(r.data)) {
            console.log(`     Array-Länge: ${r.data.length}`);
            console.log(`     Elemente:`, r.data.slice(0, 15).map((v, i) => `[${i}]=${v}`).join('   '));
            if (r.data.length > 15) console.log(`     ... (weitere ${r.data.length - 15} Elemente)`);
            if (typeof r.data[0] === 'number' && r.data[0] > 1_700_000_000) {
                const d = new Date(r.data[0] * 1000);
                console.log(`     Index [0] => Unix-Timestamp?  ${r.data[0]}  → ${d.toISOString()} (UTC)`);
            }
        } else if (typeof r.data === 'object') {
            console.log('     Typ: Object → Keys:', Object.keys(r.data));
            // Einfach den Anfang ausgeben
            console.log('     Inhalt (gekürzt):', JSON.stringify(r.data).slice(0, 500));
        } else {
            console.log('     Wert:', r.data);
        }
    }

    // Speziell für wind0: Mögliche alternative Interpretationen zeigen
    const wind0Res = await fetchOne('wind0');
    if (wind0Res.ok && Array.isArray(wind0Res.data)) {
        const w = wind0Res.data;
        console.log('\n===== 2) Vergleich aller plausiblen Parsings für wind0 =====');
        console.log('       Original (unser aktueller Code):');
        console.log('       ', extractOldFashion(w));
        const ts = w[0] * 1000;
        const fresh = Date.now() - ts < 30 * 60 * 1000;
        console.log('\n       Variante A: [ts, speed_ms, gusts_ms, dir_deg]');
        console.log('         Speed:', fresh ? (w[1]*ms2kn).toFixed(1)+' kn' : null, 'Gust:', fresh ? (w[2]*ms2kn).toFixed(1)+' kn' : null, 'Dir:', fresh ? w[3]+'°' : null);
        console.log('\n       Variante B: [ts, dir_deg, speed_ms, gusts_ms]');
        console.log('         Speed:', fresh ? (w[2]*ms2kn).toFixed(1)+' kn' : null, 'Gust:', fresh ? (w[3]*ms2kn).toFixed(1)+' kn' : null, 'Dir:', fresh ? w[1]+'°' : null);
        console.log('\n       Variante C: [ts, gusts_ms, speed_ms, dir_deg]');
        console.log('         Speed:', fresh ? (w[2]*ms2kn).toFixed(1)+' kn' : null, 'Gust:', fresh ? (w[1]*ms2kn).toFixed(1)+' kn' : null, 'Dir:', fresh ? w[3]+'°' : null);
        console.log('\n       Variante D: [ts, speed_ms, dir_deg, gusts_ms]');
        console.log('         Speed:', fresh ? (w[1]*ms2kn).toFixed(1)+' kn' : null, 'Gust:', fresh ? (w[3]*ms2kn).toFixed(1)+' kn' : null, 'Dir:', fresh ? w[2]+'°' : null);
    }

    console.log('\n===== 3) Location-Seite (https://www.openmeteo.com/location/de/cospudener-see) scrapern: verwendete API-Aufrufe / Sensor-Keys / Station-ID suchen =====');
    const html = await fetchLocationPage();
    if (typeof html !== 'string' || html.startsWith('ERROR:')) {
        console.log('  Konnte Seite nicht holen:', html);
    } else {
        // Alle stationIds oder sensor keys im HTML suchen
        const matches = new Set();
        const re = new RegExp(`(${STATION_ID}|stationId|observations/openmeteo|sensor|["']wind["']|wind0|wind_10m|gust|gusts|windSpeed|windDirection|["']t2["']|["']th1["']|["']baro0["'])`, 'gi');
        let m;
        while ((m = re.exec(html)) !== null) {
            const ctx = html.slice(Math.max(0, m.index - 40), m.index + m[0].length + 60).replace(/\s+/g, ' ');
            matches.add('  - …' + ctx + '…');
        }
        if (matches.size) {
            console.log(`  ${matches.size} interessante Stellen im HTML:`);
            for (const line of matches) console.log(line);
        } else {
            console.log('  Keine Treffer in HTML. Ggf. per JS geladen. Ganze Seite-Size:', html.length, 'Zeichen');
        }
        // Extra: Such nach JSON-Blöcken mit "api" oder "observations"
        const apiUrls = [...html.matchAll(/https?:\/\/[^"'`\s<>]+observations[^"'`\s<>]*/g)].map(x => x[0]);
        if (apiUrls.length) {
            console.log('\n  Direkte observation URLs im HTML:');
            [...new Set(apiUrls)].slice(0, 20).forEach(u => console.log('   •', decodeURIComponent(u)));
        }
    }
})();
