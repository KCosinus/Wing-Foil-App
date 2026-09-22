process.env.SUPABASE_URL = 'https://rnsntqcllorqvusjunkn.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJuc250cWNsbG9ycXZ1c2p1bmtuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4OTg5OTM4NywiZXhwIjoyMTA1NDc1Mzg3fQ.3iQhjegZME8RMkSH8VbIrHopCiFGjYO-9FAfZuVzPnM';
const https = require('https');

const base = process.env.SUPABASE_URL + '/rest/v1/weather_measurements?station_id=eq.cospudener-see';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { apikey: key, Authorization: 'Bearer ' + key };

function get(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: h }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej);
  });
}

(async () => {
  console.log('===== Letzte 16 Buckets (neuste oben) =====');
  console.log('Zeit (UTC)           | Grund   | Böe MAX | Richtung | Luft | Wasser | Humm | Druck');
  console.log('---------------------+---------+---------+----------+------+--------+------+--------');
  const rows16 = await get(base + '&order=timestamp.desc&limit=16');
  for (const r of rows16) {
    const ts = r.timestamp.replace('T', ' ').slice(0, 19);
    const ws = r.wind_speed != null ? r.wind_speed.toFixed(1).padStart(5) + ' kn' : '  -   ';
    const wg = r.wind_gust != null ? r.wind_gust.toFixed(1).padStart(5) + ' kn' : '  -   ';
    const wd = r.wind_direction != null ? Math.round(r.wind_direction).toString().padStart(6) + '°' : '    -';
    const at = r.temperature != null ? r.temperature.toFixed(1) + '°' : ' - ';
    const wt = r.water_temperature != null ? r.water_temperature.toFixed(1) + '°' : ' - ';
    const hu = r.humidity != null ? Math.round(r.humidity) + '%' : ' - ';
    const prNum = r.pressure != null ? Math.round(r.pressure) : null;
    const pr = prNum != null ? String(prNum) : ' -';
    console.log(`${ts} | ${ws} | ${wg} | ${wd} | ${at.padStart(4)} | ${wt.padStart(5)} | ${hu.padStart(3)} | ${pr.padStart(4)}`);
  }

  // Count Buckets mit wind_speed > 0 oder wind_gust > 0
  console.log('');
  const all = await get(base + '&order=timestamp.desc&limit=200');
  const nonZero = all.filter(r => r.wind_gust > 0 || r.wind_speed > 0);
  console.log('Buckets mit WIND > 0 in den letzten ~200:', nonZero.length + ' / ' + all.length);
  if (nonZero.length) {
    console.log('');
    console.log('===== Buckets mit NICHT-NULL-Wind (Beispiele der letzten 200) =====');
    for (const r of nonZero.slice(0, 10)) {
      const ts = r.timestamp.replace('T', ' ').slice(0, 19);
      const ws = r.wind_speed != null ? r.wind_speed.toFixed(1) + ' kn' : '-';
      const wg = r.wind_gust != null ? r.wind_gust.toFixed(1) + ' kn' : '-';
      const wd = r.wind_direction != null ? Math.round(r.wind_direction) + '°' : '-';
      console.log(`  ${ts}   Speed=${ws.padStart(7)}   MAX Böe=${wg.padStart(7)}   Dir=${wd.padStart(4)}`);
    }
  }

  // BAD-Zeilen Check (nicht auf Raster)
  const bad = all.filter(r => { const ms = new Date(r.timestamp).getTime(); return (ms/1000)%900 !== 0; });
  console.log('');
  console.log('BAD-Zeilen (nicht auf 15-Min Raster) in den letzten 200:', bad.length);
})();
