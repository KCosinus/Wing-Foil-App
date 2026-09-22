// storage.js – Modul zum Persistieren und Auslesen von Wettermessungen
// ---------------------------------------------------------------
// Imports
const fs = require('node:fs/promises');          // Async‑File‑API für lokale Speicherung
const path = require('node:path');               // Hilft beim Erstellen von Pfaden
const axios = require('axios');                  // HTTP‑Client für Supabase‑Aufrufe

// Pfad zur lokalen History‑Datei
const historyFile = path.join(__dirname, 'weather-history.json');

// Supabase‑Konfiguration (aus Umgebungsvariablen)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const useSupabase = Boolean(supabaseUrl && supabaseKey); // true → DB, false → lokale JSON

// 15 Minuten‑Bucket (in Millisekunden)
const intervalMilliseconds = 15 * 60 * 1000;

/**
 * Rundet einen beliebigen Zeitstempel auf das vorherige 15‑Minuten‑Intervall ab.
 *
 * @param {string|number|Date} timestampIsh – Wert, den `new Date()` interpretieren kann.
 * @returns {string} ISO‑String des gerundeten Zeitpunkts.
 * @throws {Error} wenn der übergebene Wert keinen gültigen Zeitstempel darstellt.
 */
function floorToInterval(timestampIsh) {
    const ms = new Date(timestampIsh).getTime();
    if (!Number.isFinite(ms)) throw new Error(`Ungültiger Zeitstempel: ${timestampIsh}`);
    return new Date(Math.floor(ms / intervalMilliseconds) * intervalMilliseconds).toISOString();
}

/**
 * Wandelt das Roh‑Messobjekt (z. B. von einer Wetter‑API) in das interne Record‑Format um.
 *
 * @param {Object} current – Roh‑Daten mit Feldern wie `temperature_2m`, `wind_speed_10m` usw.
 * @returns {Object} Normalisiertes Record‑Objekt.
 */
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

/**
 * Hilfsfunktion für sämtliche Supabase‑Requests.
 *
 * @param {string} method – HTTP‑Methode (GET, POST, …).
 * @param {string} endpoint – REST‑Endpoint (z. B. `weather_measurements`).
 * @param {Object} [body] – JSON‑Payload für POST/PUT‑Requests.
 * @returns {Promise} Axios‑Promise, das die Server‑Antwort liefert.
 */
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

/**
 * Baut ein minimales Upsert‑Payload für Supabase auf.
 * Nur Felder, die neu oder geändert sind, werden gesendet.
 *
 * @param {Object} record – Vollständiges Record‑Objekt.
 * @param {Object} [existing={}] – Optionales bereits in DB vorhandenes Objekt.
 * @returns {Object} Payload, das an Supabase gesendet wird.
 */
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

/**
 * Persistiert ein einzelnes Mess‑Record.
 * - Bei aktivierter Supabase‑Konfiguration wird ein Upsert via REST‑API ausgeführt.
 * - Ohne Supabase wird das Record in die lokale `weather-history.json` geschrieben.
 *
 * @param {Object} current – Roh‑Messdaten (wie von einer API zurückgeliefert).
 */
async function saveWeatherRecord(current) {
    const record = toRecord(current);

    if (useSupabase) {
        const body = onlyMeaningfulFields(record);
        await supabaseRequest('POST', 'weather_measurements?on_conflict=station_id,timestamp', body);
        return;
    }

    // ---------- Lokaler Dateispeicher ----------
    let history = [];
    try {
        history = JSON.parse(await fs.readFile(historyFile, 'utf8'));
    } catch (error) {
        if (error.code !== 'ENOENT') throw error; // Nur echte Lesefehler weiterwerfen
    }

    // Prüfen, ob bereits ein Eintrag für dieses Intervall existiert
    const existingIndex = history.findIndex((entry) => entry.timestamp === record.timestamp);
    if (existingIndex >= 0) {
        const prior = history[existingIndex];
        // Merge: neue Werte überschreiben nur, wenn sie definiert sind
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
        // Neuer Zeitstempel → einfach anhängen
        history.push(record);
    }

    // Chronologische Reihenfolge sicherstellen
    history.sort((first, second) => first.timestamp.localeCompare(second.timestamp));
    await fs.writeFile(historyFile, `${JSON.stringify(history, null, 2)}\n`);
}

/**
 * Füllt fehlende Wind‑Daten (speed, gust, direction, observedAt) anhand des letzten bekannten Wertes.
 *
 * @param {Array<Object>} entries – Aufsteigend sortierte Messwerte.
 * @returns {Array<Object>} Neue Liste mit „forward‑filled“ Wind‑Feldern.
 */
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

/**
 * Liest die Wetter‑Historie der letzten *hours* Stunden.
 *
 * @param {number} [hours=12] – Zeitspanne in Stunden, die zurückgeholt werden soll.
 * @returns {Promise<Array<Object>>} Array von Records (mit forward‑filled Wind‑Daten).
 */
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

    // ---------- Lokaler Pfad ----------
    try {
        const history = JSON.parse(await fs.readFile(historyFile, 'utf8'));
        const cutoff = Date.now() - hours * 60 * 60 * 1000;
        const entries = history
            .filter((entry) => new Date(entry.timestamp).getTime() >= cutoff)
            .sort((first, second) => first.timestamp.localeCompare(second.timestamp));
        return forwardFillWind(entries);
    } catch (error) {
        if (error.code === 'ENOENT') return []; // Datei existiert noch nicht → leeres Array
        throw error;
    }
}

// Exportiert die öffentlichen API‑Funktionen
module.exports = { saveWeatherRecord, readWeatherHistory, useSupabase };
