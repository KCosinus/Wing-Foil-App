begin;

-- Bessere Konsolidierung: Pro 15-Min-Bucket wird jetzt die *informativste* Zeile
-- behalten (Zeile mit echten Windwerten ist IMMER besser als Zeile mit NULL-Werten,
-- selbst wenn sie älter ist). Falls gleichwertig: die zuletzt geschriebene (created_at).

with bucketed as (
    select
        id,
        station_id,
        timestamp as original_ts,
        to_timestamp(
            floor(extract(epoch from timestamp at time zone 'UTC') / 900) * 900
        ) at time zone 'UTC' as bucket_ts,
        created_at,
        wind_speed,
        wind_gust,
        wind_direction,
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
to_delete as (
    select id from bucketed where rn > 1
)
delete from public.weather_measurements
where id in (select id from to_delete);

-- Alle verbliebenen Zeilen auf ihr Bucket-Ziel umlegen
update public.weather_measurements
set timestamp = to_timestamp(
                    floor(extract(epoch from timestamp at time zone 'UTC') / 900) * 900
                ) at time zone 'UTC'
where station_id = 'cospudener-see'
  and timestamp <> to_timestamp(
                       floor(extract(epoch from timestamp at time zone 'UTC') / 900) * 900
                   ) at time zone 'UTC';

commit;
