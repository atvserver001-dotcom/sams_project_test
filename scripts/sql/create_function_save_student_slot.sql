create or replace function public.save_student_slot(
  p_school_id uuid,
  p_student_id uuid default null,
  p_source_student_no smallint default null,
  p_year smallint default null,
  p_grade smallint default null,
  p_class_no smallint default null,
  p_student_no smallint default null,
  p_name text default null,
  p_gender text default null,
  p_birth_date date default null,
  p_email text default null,
  p_height_cm numeric default null,
  p_weight_kg numeric default null,
  p_notes text default null
)
returns public.students
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.students%rowtype;
  v_target public.students%rowtype;
  v_source public.students%rowtype;
  v_saved public.students%rowtype;
  v_buffer_no smallint;
begin
  if p_school_id is null then
    raise exception 'school_id is required';
  end if;

  if p_year is null or p_grade is null or p_class_no is null or p_student_no is null then
    raise exception 'year, grade, class_no, student_no are required';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'name is required';
  end if;

  if p_student_no < 1 or p_student_no > 30 then
    raise exception 'student_no must be between 1 and 30';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_school_id::text || ':' || p_year::text || ':' || p_grade::text || ':' || p_class_no::text,
      0
    )
  );

  if p_student_id is not null then
    select *
      into v_current
      from public.students
     where id = p_student_id
       and school_id = p_school_id
     for update;

    if not found then
      raise exception 'student not found';
    end if;

    select *
      into v_target
      from public.students
     where school_id = p_school_id
       and year = p_year
       and grade = p_grade
       and class_no = p_class_no
       and student_no = p_student_no
       and id <> p_student_id
     for update;

    if found then
      select gs::smallint
        into v_buffer_no
        from generate_series(31, 50) as gs
       where not exists (
         select 1
           from public.students s
          where s.school_id = p_school_id
            and s.year = p_year
            and s.grade = p_grade
            and s.class_no = p_class_no
            and s.student_no = gs
       )
       order by gs
       limit 1;

      if v_buffer_no is null then
        raise exception 'no temporary student number available';
      end if;

      update public.students
         set student_no = v_buffer_no,
             updated_at = now()
       where id = v_target.id;
    end if;

    update public.students
       set year = p_year,
           grade = p_grade,
           class_no = p_class_no,
           student_no = p_student_no,
           name = p_name,
           gender = p_gender,
           birth_date = p_birth_date,
           email = p_email,
           height_cm = p_height_cm,
           weight_kg = p_weight_kg,
           notes = p_notes,
           updated_at = now()
     where id = p_student_id
       and school_id = p_school_id
     returning * into v_saved;

    if v_target.id is not null then
      update public.students
         set year = p_year,
             grade = p_grade,
             class_no = p_class_no,
             student_no = v_current.student_no,
             updated_at = now()
       where id = v_target.id;
    end if;

    return v_saved;
  end if;

  select *
    into v_target
    from public.students
   where school_id = p_school_id
     and year = p_year
     and grade = p_grade
     and class_no = p_class_no
     and student_no = p_student_no
   for update;

  if found then
    if p_source_student_no is not null and p_source_student_no <> p_student_no then
      select *
        into v_source
        from public.students
       where school_id = p_school_id
         and year = p_year
         and grade = p_grade
         and class_no = p_class_no
         and student_no = p_source_student_no
         and id <> v_target.id
       for update;

      if found then
        raise exception 'source student number already exists';
      end if;

      update public.students
         set student_no = p_source_student_no,
             updated_at = now()
       where id = v_target.id;

      insert into public.students (
        school_id, year, grade, class_no, student_no, name, gender,
        birth_date, email, height_cm, weight_kg, notes, updated_at
      )
      values (
        p_school_id, p_year, p_grade, p_class_no, p_student_no, p_name, p_gender,
        p_birth_date, p_email, p_height_cm, p_weight_kg, p_notes, now()
      )
      returning * into v_saved;

      return v_saved;
    end if;

    update public.students
       set name = p_name,
           gender = p_gender,
           birth_date = p_birth_date,
           email = p_email,
           height_cm = p_height_cm,
           weight_kg = p_weight_kg,
           notes = p_notes,
           updated_at = now()
     where id = v_target.id
     returning * into v_saved;

    return v_saved;
  end if;

  insert into public.students (
    school_id, year, grade, class_no, student_no, name, gender,
    birth_date, email, height_cm, weight_kg, notes, updated_at
  )
  values (
    p_school_id, p_year, p_grade, p_class_no, p_student_no, p_name, p_gender,
    p_birth_date, p_email, p_height_cm, p_weight_kg, p_notes, now()
  )
  returning * into v_saved;

  return v_saved;
end;
$$;

grant execute on function public.save_student_slot(
  uuid, uuid, smallint, smallint, smallint, smallint, smallint,
  text, text, date, text, numeric, numeric, text
) to anon, authenticated, service_role;

do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception when others then
  null;
end $$;
