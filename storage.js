const fs = require('node:fs/promises');
const path = require('node:path');
const axios = require('axios');

const historyFile = path.join(__dirname, 'weather-history.json');
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const useSupabase = Boolean(supabaseUrl && supabaseKey);
const intervalMilliseconds = 15 * 60 * 1000;

function floorToInterval(timestampIsh) {
    const ms = new Date(timestampIsh).getTime();
    if (!Number.isFinite(ms)) throw new Error(`Ungültiger Zeitstempel: ${timestampIsh}`);
    return new Date(Math.floor(ms / intervalMilliseconds) * intervalMilliseconds).toISOString();
}

function toRecord(current) {
    return {
        timestamp: floorToInterval(current.time),
        temperature: current.temperature_2m,
        waterTemperature: current.water_temperature,
        humidity: current.relative_humidity,
        pressure: current.pressure,
        windSpeed: current.wind_speed_10m === null ? null : Number(current.wind_speed_10m.toFixed(1)),
        windDirection: current.wind_direction_10m,
        windGust: current.wind_gusts_10m === null ? null : Number(current.wind_gusts_10m.toFixed(1)),
        windObservedAt: current.wind_observed_at
    };
}

function supabaseRequest(method, endpoint, body) {
    return axios({
        method,
        url: `${supabaseUrl}/rest/v1/${endpoint}`,
        headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal'
        },
        data: body,
        timeout: 10000
    });
}

function onlyMeaningfulFields(record, existing = {}) {
    const result = {
        station_id: 'cospudener-see',
        timestamp: record.timestamp
    };
    const mapping = [
        ['temperature',       'temperature'],
        ['waterTemperature',  'water_temperature'],
        ['humidity',          'humidity'],
        ['pressure',          'pressure'],
        ['windSpeed',         'wind_speed'],
        ['windGust',          'wind_gust'],
        ['windDirection',     'wind_direction'],
        ['windObservedAt',    'wind_observed_at']
    ];
    for (const [recKey, dbKey] of mapping) {
        const newValue = record[recKey];
        if (newValue === null || newValue === undefined) continue;
        if (existing[dbKey] !== undefined && existing[dbKey] !== null && newValue === existing[dbKey]) continue;
        result[dbKey] = newValue;
    }
    return result;
}

async function saveWeatherRecord(current) {
    const record = toRecord(current);

    if (useSupabase) {
        const body = onlyMeaningfulFields(record);
        await supabaseRequest('POST', 'weather_measurements?on_conflict=station_id,timestamp', body);
        return;
    }

    let history = [];
    try {
        history = JSON.parse(await fs.readFile(historyFile, 'utf8'));
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }

    const existingIndex = history.findIndex((entry) => entry.timestamp === record.timestamp);
    if (existingIndex >= 0) {
        const prior = history[existingIndex];
        history[existingIndex] = {
            ...prior,
            temperature:      record.temperature     ?? prior.temperature,
            waterTemperature: record.waterTemperature?? prior.waterTemperature,
            humidity:         record.humidity        ?? prior.humidity,
            pressure:         record.pressure        ?? prior.pressure,
            windSpeed:        record.windSpeed       ?? prior.windSpeed,
            windGust:         record.windGust        ?? prior.windGust,
            windDirection:    record.windDirection   ?? prior.windDirection,
            windObservedAt:   record.windObservedAt  ?? prior.windObservedAt
        };
    } else {
        history.push(record);
    }

    history.sort((first, second) => first.timestamp.localeCompare(second.timestamp));
    await fs.writeFile(historyFile, `${JSON.stringify(history, null, 2)}\n`);
}

function forwardFillWind(entries) {
    let last = { windSpeed: null, windGust: null, windDirection: null, windObservedAt: null };
    return entries.map((entry) => {
        const filled = { ...entry };
        if (filled.windSpeed === null || filled.windSpeed === undefined) filled.windSpeed = last.windSpeed;
        if (filled.windGust === null || filled.windGust === undefined) filled.windGust = last.windGust;
        if (filled.windDirection === null || filled.windDirection === undefined) filled.windDirection = last.windDirection;
        if (filled.windObservedAt === null || filled.windObservedAt === undefined) filled.windObservedAt = last.windObservedAt;
        if (filled.windSpeed !== null && filled.windSpeed !== undefined) last.windSpeed = filled.windSpeed;
        if (filled.windGust !== null && filled.windGust !== undefined) last.windGust = filled.windGust;
        if (filled.windDirection !== null && filled.windDirection !== undefined) last.windDirection = filled.windDirection;
        if (filled.windObservedAt !== null && filled.windObservedAt !== undefined) last.windObservedAt = filled.windObservedAt;
        return filled;
    });
}

async function readWeatherHistory(hours = 12) {
    if (useSupabase) {
        const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
        const response = await supabaseRequest(
            'GET',
            `weather_measurements?station_id=eq.cospudener-see&timestamp=gte.${encodeURIComponent(since)}&order=timestamp.asc`
        );
        const entries = response.data.map((entry) => ({
            timestamp: entry.timestamp,
            temperature: entry.temperature,
            waterTemperature: entry.water_temperature,
            humidity: entry.humidity,
            pressure: entry.pressure,
            windObservedAt: entry.wind_observed_at,
            windSpeed: entry.wind_speed,
            windDirection: entry.wind_direction,
            windGust: entry.wind_gust
        }));
        return forwardFillWind(entries);
    }

    try {
        const history = JSON.parse(await fs.readFile(historyFile, 'utf8'));
        const cutoff = Date.now() - hours * 60 * 60 * 1000;
        const entries = history
            .filter((entry) => new Date(entry.timestamp).getTime() >= cutoff)
            .sort((first, second) => first.timestamp.localeCompare(second.timestamp));
        return forwardFillWind(entries);
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
}

module.exports = { saveWeatherRecord, readWeatherHistory, useSupabase };
