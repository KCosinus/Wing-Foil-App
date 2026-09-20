const fs = require('node:fs/promises');
const path = require('node:path');
const axios = require('axios');

const historyFile = path.join(__dirname, 'weather-history.json');
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const useSupabase = Boolean(supabaseUrl && supabaseKey);

function toRecord(current) {
    return {
        timestamp: current.time,
        temperature: current.temperature_2m,
        windSpeed: current.wind_speed_10m,
        windDirection: current.wind_direction_10m,
        windGust: current.wind_gusts_10m
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

async function saveWeatherRecord(current) {
    const record = toRecord(current);

    if (useSupabase) {
        await supabaseRequest('POST', 'weather_measurements?on_conflict=station_id,timestamp', {
            station_id: 'cospudener-see',
            timestamp: record.timestamp,
            temperature: record.temperature,
            wind_speed: record.windSpeed,
            wind_gust: record.windGust,
            wind_direction: record.windDirection
        });
        return;
    }

    let history = [];
    try {
        history = JSON.parse(await fs.readFile(historyFile, 'utf8'));
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }

    const existingIndex = history.findIndex((entry) => entry.timestamp === record.timestamp);
    if (existingIndex >= 0) history[existingIndex] = record;
    else history.push(record);

    history.sort((first, second) => first.timestamp.localeCompare(second.timestamp));
    await fs.writeFile(historyFile, `${JSON.stringify(history, null, 2)}\n`);
}

async function readWeatherHistory(hours = 12) {
    if (useSupabase) {
        const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
        const response = await supabaseRequest(
            'GET',
            `weather_measurements?station_id=eq.cospudener-see&timestamp=gte.${encodeURIComponent(since)}&order=timestamp.asc`
        );
        return response.data.map((entry) => ({
            timestamp: entry.timestamp,
            temperature: entry.temperature,
            windSpeed: entry.wind_speed,
            windDirection: entry.wind_direction,
            windGust: entry.wind_gust
        }));
    }

    try {
        const history = JSON.parse(await fs.readFile(historyFile, 'utf8'));
        const cutoff = Date.now() - hours * 60 * 60 * 1000;
        return history.filter((entry) => new Date(entry.timestamp).getTime() >= cutoff);
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
}

module.exports = { saveWeatherRecord, readWeatherHistory, useSupabase };
