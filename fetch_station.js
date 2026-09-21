require('dotenv').config();

const axios = require('axios');
const { saveWeatherRecord, useSupabase } = require('./storage');

const stationApi = 'https://api.openmeteo.com/observations/openmeteo/1001';
const metersPerSecondToKnots = 1.943844;

async function readSensor(sensor) {
    const { data } = await axios.get(`${stationApi}/${sensor}`, { timeout: 10000 });
    return data;
}

async function getCospudenerSeeWeather(logForecast = true) {
    try {
        const [wind, waterTemperature, air, pressure] = await Promise.all([
            readSensor('wind0'),
            readSensor('t2'),
            readSensor('th1'),
            readSensor('baro0')
        ]);
        const windTimestamp = wind[0] * 1000;
        const windIsFresh = Date.now() - windTimestamp < 30 * 60 * 1000;
        const current = {
            time: new Date().toISOString(),
            temperature_2m: air[1],
            water_temperature: waterTemperature[1],
            relative_humidity: air[2],
            pressure: pressure[1],
            wind_speed_10m: windIsFresh ? wind[3] * metersPerSecondToKnots : null,
            wind_direction_10m: windIsFresh ? wind[1] : null,
            wind_gusts_10m: windIsFresh ? wind[2] * metersPerSecondToKnots : null,
            wind_observed_at: new Date(windTimestamp).toISOString()
        };

        await saveWeatherRecord(current);

        console.log('Wetter am Cospudener See:');
        console.log(`Gespeichert: ${current.time} (${useSupabase ? 'Supabase' : 'lokal'})`);
        console.log(`Grundwind: ${current.wind_speed_10m === null ? 'nicht aktuell' : `${current.wind_speed_10m.toFixed(1)} kn`}`);
        console.log(`Böe: ${current.wind_gusts_10m === null ? 'nicht aktuell' : `${current.wind_gusts_10m.toFixed(1)} kn`}`);
        console.log(`Wassertemperatur: ${current.water_temperature} °C`);
        console.log(`Lufttemperatur: ${current.temperature_2m} °C`);

        return current;
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