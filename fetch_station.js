const axios = require('axios');
const { saveWeatherRecord, useSupabase } = require('./storage');

async function getCospudenerSeeWeather(logForecast = true) {
    const url = 'https://api.open-meteo.com/v1/forecast';

    try {
        const { data } = await axios.get(url, {
            params: {
                latitude: 51.252,
                longitude: 12.337,
                current: [
                    'temperature_2m',
                    'wind_speed_10m',
                    'wind_direction_10m',
                    'wind_gusts_10m'
                ].join(','),
                minutely_15: [
                    'wind_speed_10m',
                    'wind_gusts_10m'
                ].join(','),
                forecast_days: 1,
                wind_speed_unit: 'kn',
                timezone: 'Europe/Berlin'
            },
            timeout: 10000
        });

        await saveWeatherRecord(data.current);

        console.log('Wetter am Cospudener See:');
        console.log(`Gespeichert: ${data.current.time} (${useSupabase ? 'Supabase' : 'lokal'})`);
        console.log(`Temperatur: ${data.current.temperature_2m} °C`);
        console.log(`Windgeschwindigkeit: ${data.current.wind_speed_10m} kn`);
        console.log(`Windrichtung: ${data.current.wind_direction_10m}°`);
        console.log(`Aktuelle Böe: ${data.current.wind_gusts_10m} kn`);

        if (logForecast) {
            console.log('\n--- Windbewertung alle 15 Minuten ---');

            data.minutely_15.time.forEach((time, index) => {
                const baseWind = data.minutely_15.wind_speed_10m[index];
                const strongestGust = data.minutely_15.wind_gusts_10m[index];
                const gustFactor = strongestGust / baseWind;

                console.log(
                    `${time}: Grundwind ${baseWind.toFixed(1)} kn, `
                    + `stärkste Böe ${strongestGust.toFixed(1)} kn, `
                    + `Böenstärke +${(strongestGust - baseWind).toFixed(1)} kn, `
                    + `Böenfaktor ${gustFactor.toFixed(1)}`
                );
            });
        }

        return data.current;
    } catch (error) {
        console.error(
            'Fehler beim Abrufen der Wetterdaten:',
            error.response?.data || error.message
        );
    }
}

if (require.main === module) {
    getCospudenerSeeWeather();
}

module.exports = { getCospudenerSeeWeather };