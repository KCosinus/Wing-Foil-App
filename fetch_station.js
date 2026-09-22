require('dotenv').config();

const axios = require('axios');
const { saveWeatherRecord, useSupabase } = require('./storage');

const stationApi = 'https://api.openmeteo.com/observations/openmeteo/1001';
const metersPerSecondToKnots = 1.943844;
const intervalMilliseconds = 15 * 60 * 1000;
const staleWindMilliseconds = 30 * 60 * 1000;

function getIntervalTimestamp(from = Date.now()) {
    return new Date(
        Math.floor(from / intervalMilliseconds) * intervalMilliseconds
    ).toISOString();
}

function floorToBucket(tsMs) {
    return Math.floor(tsMs / intervalMilliseconds) * intervalMilliseconds;
}

async function readSensor(sensor) {
    const { data } = await axios.get(`${stationApi}/${sensor}`, { timeout: 10000 });
    return data;
}

function median(values) {
    if (!values.length) return null;
    const s = [...values].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    if (s.length % 2 === 0) return (s[mid - 1] + s[mid]) / 2;
    return s[mid];
}

function average(values) {
    if (!values.length) return null;
    let s = 0;
    for (const v of values) s += v;
    return s / values.length;
}

async function aggregateWindForBuckets(bucketTimesMs) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const tsPath = `${yyyy}${mm}${dd}`;
    const rows = await readSensor(`wind0/${tsPath}`);
    const freshCutoff = Date.now() - staleWindMilliseconds;

    const buckets = new Map();
    for (const bms of bucketTimesMs) {
        buckets.set(bms, { speeds: [], gusts: [], dirs: [], lastSeen: 0 });
    }

    let latestObservedAt = 0;
    if (Array.isArray(rows)) {
        for (const row of rows) {
            const ts = row[0] * 1000;
            if (ts > latestObservedAt) latestObservedAt = ts;
            const dir = row[1];
            const gustMs = row[2];
            const speedMs = row[3];
            const bucketMs = floorToBucket(ts);
            if (!buckets.has(bucketMs)) continue;
            const b = buckets.get(bucketMs);
            if (ts > b.lastSeen) b.lastSeen = ts;
            if (typeof dir === 'number' && Number.isFinite(dir)) b.dirs.push(dir);
            if (typeof speedMs === 'number' && Number.isFinite(speedMs)) b.speeds.push(speedMs);
            if (typeof gustMs === 'number' && Number.isFinite(gustMs)) b.gusts.push(gustMs);
        }
    }

    const windIsFresh = latestObservedAt >= freshCutoff;
    const result = new Map();
    for (const [bucketMs, b] of buckets) {
        const bucketFresh = bucketMs <= floorToBucket(latestObservedAt);
        const active = windIsFresh && bucketFresh;
        const avgSpeedMs = active ? average(b.speeds) : null;
        const maxGustMs = active && b.gusts.length ? Math.max(...b.gusts) : null;
        const dir = active ? median(b.dirs) : null;
        result.set(bucketMs, {
            bucket: new Date(bucketMs).toISOString(),
            wind_speed_10m: avgSpeedMs === null ? null : avgSpeedMs * metersPerSecondToKnots,
            wind_gusts_10m: maxGustMs === null ? null : maxGustMs * metersPerSecondToKnots,
            wind_direction_10m: dir,
            lastSeenInBucket: b.lastSeen ? new Date(b.lastSeen).toISOString() : null
        });
    }
    return {
        observed_at: latestObservedAt ? new Date(latestObservedAt).toISOString() : null,
        windIsFresh,
        result
    };
}

async function aggregateOtherSensors(sensor, valueIndex = 1) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const tsPath = `${yyyy}${mm}${dd}`;
    let rows;
    try {
        rows = await readSensor(`${sensor}/${tsPath}/last24h`);
    } catch (_) {
        try {
            rows = await readSensor(`${sensor}/last24h`);
        } catch (__) {
            const arr = await readSensor(sensor);
            const ts = arr[0] * 1000;
            const v = arr[valueIndex];
            return new Map([[floorToBucket(ts), v]]);
        }
    }
    const out = new Map();
    if (Array.isArray(rows)) {
        const perBucket = new Map();
        for (const row of rows) {
            const ts = row[0] * 1000;
            const v = row[valueIndex];
            const bucketMs = floorToBucket(ts);
            if (!perBucket.has(bucketMs)) perBucket.set(bucketMs, []);
            if (typeof v === 'number' && Number.isFinite(v)) perBucket.get(bucketMs).push(v);
        }
        for (const [bms, arr] of perBucket) {
            if (arr.length) out.set(bms, average(arr));
        }
    }
    return out;
}

async function getCospudenerSeeWeather(logForecast = true, refillBucketsHours = 24) {
    try {
        const now = Date.now();
        const startMs = floorToBucket(now - refillBucketsHours * 60 * 60 * 1000);
        const endMs = floorToBucket(now);
        const bucketTimesMs = [];
        for (let t = startMs; t <= endMs; t += intervalMilliseconds) bucketTimesMs.push(t);

        const [
            windAgg,
            waterAgg,
            airAgg,
            humAgg,
            pressureAgg
        ] = await Promise.all([
            aggregateWindForBuckets(bucketTimesMs),
            aggregateOtherSensors('t2', 1),
            aggregateOtherSensors('th1', 1),
            aggregateOtherSensors('th1', 2),
            aggregateOtherSensors('baro0', 1)
        ]);

        let lastSaved = null;
        for (const bucketMs of bucketTimesMs) {
            const w = windAgg.result.get(bucketMs);
            const water = waterAgg.get(bucketMs) ?? null;
            const airT = airAgg.get(bucketMs) ?? null;
            const airH = humAgg.get(bucketMs) ?? null;
            const press = pressureAgg.get(bucketMs) ?? null;

            const current = {
                time: new Date(bucketMs).toISOString(),
                temperature_2m: airT,
                water_temperature: water,
                relative_humidity: airH,
                pressure: press,
                wind_speed_10m: w ? w.wind_speed_10m : null,
                wind_direction_10m: w ? w.wind_direction_10m : null,
                wind_gusts_10m: w ? w.wind_gusts_10m : null,
                wind_observed_at: windAgg.observed_at
            };

            await saveWeatherRecord(current);
            lastSaved = { current, bucketMs };
        }

        if (lastSaved && logForecast) {
            const current = lastSaved.current;
            console.log('Wetter am Cospudener See:');
            console.log(`Buckets verarbeitet: ${bucketTimesMs.length} (${useSupabase ? 'Supabase' : 'lokal'})`);
            console.log(`Letzter Bucket: ${current.time} (Wind frisch: ${windAgg.windIsFresh ? 'JA' : 'NEIN'})`);
            console.log(`Grundwind (Ø im Bucket): ${current.wind_speed_10m === null ? 'nicht aktuell' : `${current.wind_speed_10m.toFixed(1)} kn`}`);
            console.log(`Böe (MAX im Bucket): ${current.wind_gusts_10m === null ? 'nicht aktuell' : `${current.wind_gusts_10m.toFixed(1)} kn`}`);
            console.log(`Richtung (Median): ${current.wind_direction_10m === null ? '-' : `${Math.round(current.wind_direction_10m)}°`}`);
            console.log(`Wassertemperatur: ${current.water_temperature === null ? '-' : current.water_temperature.toFixed(1) + ' °C'}`);
            console.log(`Lufttemperatur: ${current.temperature_2m === null ? '-' : current.temperature_2m.toFixed(1) + ' °C'}`);
        }

        return lastSaved?.current ?? null;
    } catch (error) {
        console.error(
            'Fehler beim Abrufen der Wetterdaten:',
            error.response?.data || error.message
        );
        throw error;
    }
}

if (require.main === module) {
    getCospudenerSeeWeather();
}

module.exports = { getCospudenerSeeWeather };