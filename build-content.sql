-- Builds the items[] array for content.json from the live CMS.
-- Output: a single JSON array. zone ∈ tv|lab|events|mag|shop.
\set base 'https://ralph-world-production.up.railway.app'

with art as (
  select
    title, slug, subtitle, intro, card_image_url, lead_media_url, lead_media_type,
    row_number() over (order by coalesce(sort_order, 2147483647), published_at desc nulls last) as rn
  from articles
  where status = 'published' and title is not null
  order by coalesce(sort_order, 2147483647), published_at desc nulls last
  limit 10
),
items as (
  -- Articles: real magazine stories, split across the TV and Magazine zones
  select
    case when (rn % 2) = 1 then 'tv' else 'mag' end as zone,
    'article' as type,
    title,
    coalesce(
      card_image_url,
      case when coalesce(lead_media_type,'') = 'image'
             or lead_media_url ~* '\.(jpg|jpeg|png|webp)(\?|$)'
           then lead_media_url end
    ) as image,
    left(trim(regexp_replace(coalesce(subtitle, intro, ''), '<[^>]*>', '', 'g')), 200) as excerpt,
    :'base' || '/magazine/' || slug as url
  from art

  union all
  -- Magazine issues
  select 'mag', 'magazine',
    coalesce(title, 'Issue ' || issue_number),
    null,
    'Issue ' || issue_number || ' — out now from the ralph.world press.',
    :'base' || '/magazine'
  from magazine_issues
  where status = 'published'

),
ev as (
  select 'events' as zone, 'event' as type,
    title,
    thumbnail_url as image,
    left(trim(regexp_replace(coalesce(description_short,''), '<[^>]*>', '', 'g')), 200) as excerpt,
    :'base' || '/events/' || slug as url
  from events
  where status = 'published'
  order by event_date desc nulls last
  limit 6
),
lab as (
  select 'lab' as zone, 'lab' as type,
    title,
    thumbnail_url as image,
    left(trim(regexp_replace(coalesce(description,''), '<[^>]*>', '', 'g')), 200) as excerpt,
    coalesce(external_url, :'base' || '/lab') as url
  from lab_items
  where status = 'published'
  order by coalesce(sort_order, 2147483647)
  limit 7
),
shop as (
  select 'shop' as zone, 'shop' as type,
    'The ralph shop' as title,
    null::text as image,
    'Print, merch and curios from the ralph.world store.' as excerpt,
    :'base' || '/shop' as url
)
select json_agg(row_to_json(t))
from (
  select zone, type, title, image, excerpt, url from items
  union all
  select zone, type, title, image, excerpt, url from ev
  union all
  select zone, type, title, image, excerpt, url from lab
  union all
  select zone, type, title, image, excerpt, url from shop
) t;
