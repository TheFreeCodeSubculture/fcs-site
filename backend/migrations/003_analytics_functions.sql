-- Analytics report functions. Authorization is enforced by the API routes,
-- not by the database, because the backend is the only database client.

create or replace function analytics_report(
  since timestamptz,
  until timestamptz,
  tz text default 'UTC'
)
returns jsonb
language plpgsql
stable
as $$
declare
  span   interval := until - since;
  prev   timestamptz := since - span;
  bucket text := case when span <= interval '2 days' then 'hour' else 'day' end;
  result jsonb;
begin
  if tz is null or not exists (select 1 from pg_timezone_names where name = tz) then
    tz := 'UTC';
  end if;

  with pv as (
    select * from analytics_pageviews where at >= prev and at < until
  ),
  sessions as (
    select session, at >= since as current, count(*) as views, sum(engaged_ms) as engaged,
           bool_or(is_new) as is_new
      from pv group by session, at >= since
  ),
  totals as (
    select current,
           (select count(*) from (
              select distinct date_trunc('day', p.at, tz), p.visitor
                from pv p where (p.at >= since) = s.current
            ) d) as visitors,
           count(*) filter (where is_new) as new_sessions,
           sum(views) as pageviews,
           count(*) as sessions,
           round(100.0 * count(*) filter (where views = 1 and engaged < 10000) / nullif(count(*), 0), 1) as bounce_rate,
           round(avg(engaged) / 1000.0, 1) as avg_engaged_s,
           round(avg(views)::numeric, 2) as pages_per_session
      from sessions s group by current
  )
  select jsonb_build_object(
    'bucket', bucket,
    'current', coalesce((select to_jsonb(t) - 'current' from totals t where current), '{}'::jsonb),
    'previous', coalesce((select to_jsonb(t) - 'current' from totals t where not current), '{}'::jsonb),
    'series', coalesce((
      select jsonb_agg(jsonb_build_object(
               't', b, 'visitors', v, 'pageviews', n, 'sessions', ss,
               'desktop', vd, 'mobile', vm, 'tablet', vt) order by b)
      from (
        select date_trunc(bucket, at, tz) as b,
               count(distinct visitor) as v, count(*) as n, count(distinct session) as ss,
               count(distinct visitor) filter (where device = 'desktop') as vd,
               count(distinct visitor) filter (where device = 'mobile') as vm,
               count(distinct visitor) filter (where device = 'tablet') as vt
          from pv where at >= since group by 1
      ) s), '[]'::jsonb),
    'pages', coalesce((
      select jsonb_agg(x) from (
        select path as name, count(*) as views, count(distinct visitor) as visitors
          from pv where at >= since group by path order by 2 desc limit 10
      ) x), '[]'::jsonb),
    'referrers', coalesce((
      select jsonb_agg(x) from (
        select coalesce(referrer_host, 'Direct') as name, count(distinct session) as sessions
          from pv where at >= since group by 1 order by 2 desc limit 10
      ) x), '[]'::jsonb),
    'campaigns', coalesce((
      select jsonb_agg(x) from (
        select concat_ws(' / ', utm_source, utm_medium, utm_campaign) as name,
               count(distinct session) as sessions
          from pv where at >= since and utm_source is not null group by 1 order by 2 desc limit 10
      ) x), '[]'::jsonb),
    'devices', coalesce((
      select jsonb_agg(x) from (
        select coalesce(device, 'unknown') as name, count(distinct session) as sessions
          from pv where at >= since group by 1 order by 2 desc
      ) x), '[]'::jsonb),
    'regions', coalesce((
      select jsonb_agg(x) from (
        select coalesce(timezone, 'unknown') as name, count(distinct session) as sessions
          from pv where at >= since group by 1 order by 2 desc limit 10
      ) x), '[]'::jsonb),
    'countries', coalesce((
      select jsonb_agg(x) from (
        select coalesce(country, 'unknown') as name, count(distinct session) as sessions
          from pv where at >= since group by 1 order by 2 desc limit 10
      ) x), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(x) from (
        select name, count(*) as count, count(distinct visitor) as visitors
          from analytics_events
         where at >= since and at < until and name <> 'section'
         group by name order by 2 desc
      ) x), '[]'::jsonb),
    'sections', coalesce((
      select jsonb_agg(x) from (
        select label as name, count(distinct session) as sessions
          from analytics_events
         where at >= since and at < until and name = 'section'
         group by label order by 2 desc
      ) x), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

create or replace function blog_post_analytics(
  post_slug text,
  days int default 28,
  tz text default 'UTC'
)
returns jsonb
language plpgsql
stable
as $$
declare
  since timestamptz := date_trunc('day', now() at time zone tz) at time zone tz
                       - make_interval(days => greatest(1, least(days, 365)) - 1);
  result jsonb;
begin
  if tz is null or not exists (select 1 from pg_timezone_names where name = tz) then
    tz := 'UTC';
  end if;

  with views as (
    select v.at, v.visitor, v.engaged_ms, v.referrer_host
      from analytics_pageviews v
     where v.path like '%/blog/' || post_slug || '/' and v.at >= since
  ),
  days_list as (
    select generate_series(
      date_trunc('day', since at time zone tz),
      date_trunc('day', now() at time zone tz),
      interval '1 day'
    )::date as day
  )
  select jsonb_build_object(
    'since', since,
    'views', (select count(*) from views),
    'visitors', (select count(distinct visitor) from views),
    'avg_engaged_ms', (select coalesce(round(avg(engaged_ms)), 0) from views where engaged_ms > 0),
    'daily', (select jsonb_agg(jsonb_build_object(
                 'day', d.day, 'views', coalesce(c.views, 0),
                 'visitors', coalesce(c.visitors, 0)) order by d.day)
                from days_list d
                left join (
                  select (at at time zone tz)::date as day,
                         count(*) as views, count(distinct visitor) as visitors
                    from views group by 1
                ) c on c.day = d.day),
    'referrers', (select coalesce(jsonb_agg(jsonb_build_object(
                     'host', r.host, 'views', r.n) order by r.n desc), '[]'::jsonb)
                    from (
                      select coalesce(nullif(referrer_host, ''), 'Direct') as host,
                             count(*) as n
                        from views group by 1 order by 2 desc limit 5
                    ) r)
  ) into result;

  return result;
end;
$$;
