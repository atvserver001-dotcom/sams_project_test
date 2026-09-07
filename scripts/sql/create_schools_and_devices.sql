-- schools: 그룹번호(pk, 4자리 숫자), 학교 이름(텍스트), 디바이스 인덱스(FK 배열), 인식키(텍스트)
-- devices: 학교(fk), 기기이름(텍스트), 시작날짜, 종료날짜, 기간제한(bool)

create table if not exists public.schools (
  id uuid primary key default gen_random_uuid(),
  group_no text not null check (group_no ~ '^[0-9]{4}$'),
  name text not null,
  school_type integer not null check (school_type in (1,2,3)) default 1,
  recognition_key text not null,
  created_at timestamptz not null default now()
);

comment on column public.schools.id is '학교 PK (uuid)';
comment on column public.schools.group_no is '그룹번호(4자리 숫자)';
comment on column public.schools.name is '학교 이름';
comment on column public.schools.school_type is '학교 종류 코드 (1:초등학교, 2:중학교, 3:고등학교)';
comment on column public.schools.recognition_key is '인식키';

-- 2) Rename legacy devices -> device_management (if legacy exists)
create extension if not exists pgcrypto;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'devices' and column_name = 'group_no'
  ) then
    execute 'alter table public.devices rename to device_management';
  end if;
end $$;

-- 8) Reload PostgREST (Supabase API) schema cache so new columns are recognized
do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception when others then
  -- ignore if pg_notify is not available in the environment
  null;
end $$;

-- 3) Create master devices table (id, device_name)
create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  device_name text not null,
  sort_order integer
);

comment on column public.devices.device_name is '디바이스 이름 (마스터)';
comment on column public.devices.sort_order is '표시 순서(오름차순)';

-- 4) Create device_management table (school-device assignment + period)
create table if not exists public.device_management (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  device_id uuid not null references public.devices(id),
  start_date date,
  end_date date,
  limited_period boolean not null default false,
  created_at timestamptz not null default now()
);

comment on column public.device_management.school_id is 'schools 테이블의 id FK';
comment on column public.device_management.device_id is 'devices 테이블의 FK';
comment on column public.device_management.start_date is '시작 날짜';
comment on column public.device_management.end_date is '종료 날짜';
comment on column public.device_management.limited_period is '기간 제한 여부';

-- 5) Optional index for listing by school
create index if not exists idx_device_mgmt_school_id on public.device_management(school_id);

-- 6) Keep schools.device_ids[] in sync with device_management
-- (legacy sync triggers removed; not needed with normalized FK)

-- 7) Ensure school_type exists for existing deployments and is integer code (1/2/3)
do $$
begin
  -- if column does not exist, add as integer with default
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'schools' and column_name = 'school_type'
  ) then
    execute 'alter table public.schools add column school_type integer not null default 1';
    execute 'alter table public.schools add constraint chk_school_type check (school_type in (1,2,3))';
  else
    -- column exists; if it is text, convert to integer using mapping
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'schools' and column_name = 'school_type' and data_type = 'text'
    ) then
      -- drop existing check constraints involving school_type if any
      perform (
        select
          case when conname is not null then
            (format('alter table public.schools drop constraint %I', conname))
          end
        from (
          select conname
          from pg_constraint c
          join pg_class t on c.conrelid = t.oid
          join pg_namespace n on t.relnamespace = n.oid
          where n.nspname = 'public' and t.relname = 'schools' and contype = 'c'
        ) s
        where conname is not null
      );
      -- convert text labels to integer codes
      execute $$update public.schools set school_type = case school_type
        when '초등학교' then '1'
        when '중학교' then '2'
        when '고등학교' then '3'
        else '1'
      end$$;
      -- change column type to integer
      execute $$alter table public.schools alter column school_type type integer using school_type::integer$$;
      -- add check constraint back
      execute $$alter table public.schools add constraint chk_school_type check (school_type in (1,2,3))$$;
      -- set default
      execute $$alter table public.schools alter column school_type set default 1$$;
      -- set not null
      execute $$alter table public.schools alter column school_type set not null$$;
    end if;
  end if;
end $$;


