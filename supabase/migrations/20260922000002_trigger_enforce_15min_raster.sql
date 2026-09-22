begin;

-- =========================================================================
-- 1) Bestehende Verunreinigungen konsolidieren
--    a) Pro Bucket die "beste" Zeile behalten (siehe letzter Migration)
--    b) Bucket-Timestamp korrigieren
-- =========================================================================
with bucketed as (
    select
        id,
        to_timestamp(
            floor(extract(epoch from timestamp at time zone 'UTC') / 900) * 900
        ) at time zone 'UTC' as bucket_ts,
        created_at,
        row_number() over (
            partition by station_id,
                         to_timestamp(
                             floor(extract(epoch from timestamp at time zone 'UTC') / 900) * 900
                         ) at time zone 'UTC'
            order by
                (case when wind_speed    is not null then 1 else 0 end) desc,
                (case when wind_gust     is not null then 1 else 0 end) desc,
                (case when wind_direction is not null then 1 else 0 end) desc,
                created_at desc,
                id desc
        ) as rn
    from public.weather_measurements
    where station_id = 'cospudener-see'
),
to_delete as (select id from bucketed where rn > 1)
delete from public.weather_measurements where id in (select id from to_delete);

update public.weather_measurements
set timestamp = to_timestamp(
                    floor(extract(epoch from timestamp at time zone 'UTC') / 900) * 900
                ) at time zone 'UTC'
where station_id = 'cospudener-see'
  and timestamp <> to_timestamp(
                       floor(extract(epoch from timestamp at time zone 'UTC') / 900) * 900
                   ) at time zone 'UTC';

-- =========================================================================
-- 2) Dauerschutz durch Trigger
--    Jede INSERT/UPDATE-Zeile wird SOFORT auf das 15-Min-Raster gerundet.
-- =========================================================================

create or replace function public.weather_measurements_snap_timestamp()
returns trigger
language plpgsql
as $$
begin
    new.timestamp := to_timestamp(
                         floor(extract(epoch from new.timestamp at time zone 'UTC') / 900) * 900
                     ) at time zone 'UTC';
    return new;
end;
$$;

drop trigger if exists weather_measurements_snap_timestamp_trigger
    on public.weather_measurements;

create trigger weather_measurements_snap_timestamp_trigger
before insert or update of timestamp
on public.weather_measurements
for each row
execute function public.weather_measurements_snap_timestamp();

-- =========================================================================
-- 3) Zusätzlicher Trigger: Doppelte Buckets bei INSERT direkt durch Upsert
--    ersetzen. Ohne das würde bei ident. Raster-Timestamp der UNIQUE-Constraint
--    einen Fehler werfen.
-- =========================================================================

commit;
