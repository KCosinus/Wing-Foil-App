begin;

-- 1) Bucket pro Zeile berechnen (auf die viertelstunde abrunden) und
--    die Zeile behalten, die innerhalb eines Buckets zuletzt geschrieben wurde.
--    Alle anderen Zeilen desselben Buckets entfernen wir, bevor wir den
--    Zeitstempel selbst auf den Bucket-Wert umstellen. Sonst verletzen wir
--    den Unique-Constraint (station_id, timestamp).

with prepared as (
    select
        id,
        station_id,
        timestamp as original_ts,
        to_timestamp(
            floor(extract(epoch from timestamp at time zone 'UTC') / 900) * 900
        ) at time zone 'UTC' as bucket_ts,
        created_at,
        row_number() over (
            partition by station_id,
                         to_timestamp(
                             floor(extract(epoch from timestamp at time zone 'UTC') / 900) * 900
                         ) at time zone 'UTC'
            order by created_at desc, id desc
        ) as rn
    from public.weather_measurements
    where station_id = 'cospudener-see'
),
to_delete as (
    select id from prepared where rn > 1
)
delete from public.weather_measurements
where id in (select id from to_delete);

-- 2) Jetzt bei allen verbliebenen Zeilen den timestamp auf das Bucket-Ziel
--    umstellen, falls er nicht schon passt. Das sorgt dafür, dass alles
--    auf :00 / :15 / :30 / :45 landet.

update public.weather_measurements
set timestamp = to_timestamp(
                    floor(extract(epoch from timestamp at time zone 'UTC') / 900) * 900
                ) at time zone 'UTC'
where station_id = 'cospudener-see'
  and timestamp <> to_timestamp(
                       floor(extract(epoch from timestamp at time zone 'UTC') / 900) * 900
                   ) at time zone 'UTC';

commit;
