-- US English in the messages people see. Fifteen functions are defined again
-- here, each copied from its latest migration (013, 022 or 023) with only its
-- messages changed: licence, cancelled, travelled and Expiry date become
-- license, canceled, traveled and Expiration date, and the two messages that
-- print a load's status ("Load L-0003 is cancelled") say canceled. Nothing
-- else in them changes. Code names keep their spelling: the driver_licences
-- tables and functions, the driver-licences bucket, the 'licence' queue item,
-- the 'expiry' key and the 'cancelled' status.
--
-- The field app tells a departure held back for the licence, and a load with
-- no room for more licence photos, by these messages. Its US English update
-- accepts either spelling, but earlier builds know only "licence": publish the
-- app update first and apply this once phones have it.
BEGIN;

-- complete_invitation, from 013_access_and_user_transactions.sql
CREATE OR REPLACE FUNCTION public.complete_invitation() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE profile public.users;
BEGIN
 PERFORM pg_advisory_xact_lock(73190421);
 SELECT * INTO STRICT profile FROM public.users WHERE id=auth.uid() FOR UPDATE;
 IF NOT profile.is_active OR profile.invitation_status='cancelled' THEN RAISE EXCEPTION 'Invitation canceled' USING ERRCODE='42501'; END IF;
 IF profile.invitation_status='accepted' THEN RETURN; END IF;
 IF profile.invitation_expires_at IS NULL OR profile.invitation_expires_at<now() THEN RAISE EXCEPTION 'Invitation expired' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL AND coalesce(encrypted_password,'')<>'') THEN
  RAISE EXCEPTION 'Set a password before accepting your invitation' USING ERRCODE='42501'; END IF;
 UPDATE public.users SET invitation_status='accepted' WHERE id=auth.uid();
 INSERT INTO public.user_admin_audit(actor_user_id,target_user_id,action,details) VALUES(auth.uid(),auth.uid(),'accept_invite','{}');
END $$;

-- logistics_stop_name, from 022_loads_and_drivers.sql
create or replace function public.logistics_stop_name(p_stop public.load_stops) returns text
language sql stable set search_path=public as $$
 select 'Stop '||coalesce(p_stop.seq::text,'(canceled)')||' ('||p.name||')' from public.places p where p.id=p_stop.place_id
$$;

-- logistics_load_save, from 022_loads_and_drivers.sql
create or replace function public.logistics_load_save(p_actor uuid,p_operation_id uuid,p_project_id uuid,p_payload jsonb) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare
 v_id uuid; v_load public.loads; v_before jsonb; v_created boolean:=false; v_number integer; v_office boolean:=public.is_office_user();
 v_origin uuid; v_planned date; v_truck_type text; v_truck_number text; v_trailer text; v_bol text; v_notes text; v_driver text; v_phone text;
 v_captured timestamptz; v_list jsonb; v_elem jsonb; v_place_id uuid; v_stop public.load_stops; v_stop_id uuid; v_kind text; v_name text;
 v_stop_date date; v_ids uuid[]:='{}'; v_companies_before jsonb; i integer;
begin
 v_id:=public.logistics_id(p_payload,'loadId','Load');
 if v_id is null then raise exception 'A load ID is required' using errcode='22023'; end if;
 -- Check every field before changing anything.
 if nullif(p_payload->>'originPlaceId','') is not null then
  v_origin:=(public.logistics_place(p_project_id,public.logistics_id(p_payload,'originPlaceId','Origin'))).id;
 end if;
 v_planned:=public.logistics_date(p_payload,'plannedDate','Planned date');
 v_truck_type:=public.logistics_text(p_payload,'truckType',60,'Truck type');
 v_truck_number:=public.logistics_text(p_payload,'truckNumber',40,'Truck number');
 v_trailer:=public.logistics_text(p_payload,'trailerNumber',40,'Trailer number');
 v_bol:=public.logistics_text(p_payload,'bolNumber',60,'Bill of lading number');
 v_notes:=public.logistics_text(p_payload,'notes',2000,'Notes');
 v_driver:=public.logistics_text(p_payload,'driverName',120,'Driver name');
 v_phone:=public.logistics_text(p_payload,'driverPhone',40,'Driver phone');
 v_captured:=public.logistics_captured(p_payload);

 select * into v_load from public.loads where id=v_id for update;
 if not found then
  -- The project stays active while the load is added (completing it waits),
  -- and numbers take turns per project.
  perform 1 from public.projects p where p.id=p_project_id and p.status='active' for share;
  if not found then raise exception 'This project isn''t active; loads can''t be added' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('loads:'||p_project_id::text,0));
  select coalesce(max(substring(l.load_number from 3)::integer),0)+1 into v_number from public.loads l where l.project_id=p_project_id;
  insert into public.loads(id,project_id,load_number,origin_place_id,planned_date,truck_type,truck_number,trailer_number,bol_number,notes,
   driver_name,driver_phone,started_in_field,created_by,edited_at)
  values(v_id,p_project_id,'L-'||lpad(v_number::text,4,'0'),v_origin,v_planned,v_truck_type,v_truck_number,v_trailer,v_bol,v_notes,
   v_driver,v_phone,not v_office,p_actor,coalesce(v_captured,now()))
  returning * into v_load;
  v_created:=true;
 else
  if v_load.project_id<>p_project_id then raise exception 'That load isn''t in this project' using errcode='42501'; end if;
  if v_load.status in ('closed','cancelled') then
   raise exception 'Load % is %; it can''t change',v_load.load_number,replace(v_load.status,'cancelled','canceled') using errcode='22023';
  end if;
  if v_captured<v_load.edited_at-public.logistics_clock_slack() then
   raise exception 'Load % was changed after this edit was made; check it and save again',v_load.load_number using errcode='22023';
  end if;
  v_before:=to_jsonb(v_load);
  update public.loads l set
   origin_place_id=case when p_payload ? 'originPlaceId' then v_origin else l.origin_place_id end,
   planned_date=case when p_payload ? 'plannedDate' then v_planned else l.planned_date end,
   truck_type=case when p_payload ? 'truckType' then v_truck_type else l.truck_type end,
   truck_number=case when p_payload ? 'truckNumber' then v_truck_number else l.truck_number end,
   trailer_number=case when p_payload ? 'trailerNumber' then v_trailer else l.trailer_number end,
   bol_number=case when p_payload ? 'bolNumber' then v_bol else l.bol_number end,
   notes=case when p_payload ? 'notes' then v_notes else l.notes end,
   driver_name=case when p_payload ? 'driverName' then v_driver else l.driver_name end,
   driver_phone=case when p_payload ? 'driverPhone' then v_phone else l.driver_phone end,
   edited_at=coalesce(v_captured,now())
  where l.id=v_load.id returning * into v_load;
 end if;

 if p_payload ? 'companies' then
  v_list:=public.logistics_list(p_payload,'companies','companies');
  if jsonb_array_length(v_list)>3 then raise exception 'Add up to 3 companies' using errcode='22023'; end if;
  select coalesce(jsonb_agg(to_jsonb(c) order by c.position),'[]') into v_companies_before from public.load_companies c where c.load_id=v_load.id;
  delete from public.load_companies where load_id=v_load.id;
  for i in 0..jsonb_array_length(v_list)-1 loop
   v_elem:=v_list->i;
   if jsonb_typeof(v_elem)<>'object' then raise exception 'Each company needs a name' using errcode='22023'; end if;
   v_name:=public.logistics_text(v_elem,'name',120,'Company name');
   if v_name is null then raise exception 'Each company needs a name' using errcode='22023'; end if;
   v_kind:=coalesce(nullif(v_elem->>'role',''),'carrier');
   if v_kind not in ('broker','carrier','dispatcher','other') then
    raise exception 'A company''s role is broker, carrier, dispatcher or other' using errcode='22023';
   end if;
   insert into public.load_companies(project_id,load_id,position,name,role,contact_name,phone)
   values(p_project_id,v_load.id,i+1,v_name,v_kind,public.logistics_text(v_elem,'contactName',120,'Contact name'),public.logistics_text(v_elem,'phone',40,'Company phone'));
  end loop;
 end if;

 if p_payload ? 'stops' then
  if v_load.status in ('planning','loading') then
   if not v_office and not v_load.started_in_field then
    raise exception 'The office plans the stops of load %',v_load.load_number using errcode='42501';
   end if;
  elsif v_load.status='in_transit' then
   if not v_office then
    raise exception 'Load % has left; only office staff can change its stops',v_load.load_number using errcode='42501';
   end if;
  else
   raise exception 'Load % has been delivered; its stops can''t change',v_load.load_number using errcode='22023';
  end if;
  v_list:=public.logistics_list(p_payload,'stops','stops');
  if jsonb_array_length(v_list)>20 then raise exception 'A load can have at most 20 stops' using errcode='22023'; end if;
  for i in 0..jsonb_array_length(v_list)-1 loop
   v_elem:=v_list->i;
   if jsonb_typeof(v_elem)<>'object' then raise exception 'Each stop needs an ID and a place' using errcode='22023'; end if;
   v_stop_id:=public.logistics_id(v_elem,'id','Stop ID');
   if v_stop_id is null then raise exception 'Each stop needs an ID' using errcode='22023'; end if;
   if v_stop_id=any(v_ids) then raise exception 'Two stops share one ID' using errcode='22023'; end if;
   v_ids:=v_ids||v_stop_id;
   v_place_id:=public.logistics_id(v_elem,'placeId','Place');
   v_kind:=coalesce(nullif(v_elem->>'kind',''),'dropoff');
   if v_kind not in ('dropoff','pickup','both') then
    raise exception 'A stop is a drop-off, a pick-up or both' using errcode='22023';
   end if;
   v_stop_date:=public.logistics_date(v_elem,'plannedDate','Stop date');
   select * into v_stop from public.load_stops where id=v_stop_id for update;
   if found then
    if v_stop.load_id<>v_load.id then raise exception 'That stop belongs to another load' using errcode='42501'; end if;
    if v_stop.status in ('arrived','done') and (v_stop.place_id is distinct from v_place_id or v_stop.kind<>v_kind) then
     raise exception '% has been reached; its place and kind can''t change',public.logistics_stop_name(v_stop) using errcode='22023';
    end if;
    if v_stop.place_id is distinct from v_place_id then perform public.logistics_place(p_project_id,v_place_id); end if;
    update public.load_stops set seq=i+1,place_id=v_place_id,kind=v_kind,planned_date=v_stop_date,
     status=case when status='cancelled' then 'pending' else status end where id=v_stop_id;
   else
    perform public.logistics_place(p_project_id,v_place_id);
    insert into public.load_stops(id,project_id,load_id,seq,place_id,kind,planned_date)
    values(v_stop_id,p_project_id,v_load.id,i+1,v_place_id,v_kind,v_stop_date);
   end if;
  end loop;
  -- Stops left out are cancelled, unless the truck has been there or pieces
  -- still need them.
  for v_stop in select * from public.load_stops s where s.load_id=v_load.id and s.status<>'cancelled' and not (s.id=any(v_ids)) for update loop
   if v_stop.status in ('arrived','done') then
    raise exception '% has been reached; it stays on the load',public.logistics_stop_name(v_stop) using errcode='22023';
   end if;
   if exists(select 1 from public.load_lines x where x.status in ('planned','on_board','missing') and v_stop.id in (x.pickup_stop_id,x.dropoff_stop_id)) then
    raise exception 'The stop at % still has pieces planned for it; move them to another stop first',
     (select p.name from public.places p where p.id=v_stop.place_id) using errcode='22023';
   end if;
   update public.load_stops set status='cancelled',seq=null where id=v_stop.id;
  end loop;
  if exists(select 1 from public.load_lines x join public.load_stops d on d.id=x.dropoff_stop_id
     left join public.load_stops p on p.id=x.pickup_stop_id
    where x.load_id=v_load.id and x.status in ('planned','on_board') and (d.kind='pickup' or p.kind='dropoff' or p.seq>=d.seq)) then
   raise exception 'Every planned piece needs a drop-off stop after its pick-up stop' using errcode='22023';
  end if;
  if v_load.status='in_transit' and not exists(select 1 from public.load_stops s where s.load_id=v_load.id and s.status in ('pending','arrived')) then
   update public.loads set status='delivered',delivered_at=now() where id=v_load.id returning * into v_load;
  end if;
 end if;

 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(p_actor,'load_saved','load',v_load.id,jsonb_build_object('operation_id',p_operation_id,'created',v_created,'before',v_before,'after',to_jsonb(v_load),
   'companies_before',v_companies_before,'stops_changed',p_payload ? 'stops'),p_project_id);
 return jsonb_build_object('id',v_load.id,'load_number',v_load.load_number,'status',v_load.status,'created',v_created,
  'started_in_field',v_load.started_in_field);
end $$;

-- logistics_load_on, from 022_loads_and_drivers.sql
create or replace function public.logistics_load_on(p_actor uuid,p_operation_id uuid,p_project_id uuid,p_payload jsonb) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare
 v_load public.loads; v_at public.load_stops; v_piece record; v_line public.load_lines; v_has boolean; v_drop public.load_stops;
 v_list jsonb; v_elem jsonb; v_code text; v_from text; v_on text[]:='{}'; v_off text[]:='{}'; v_moved jsonb:='[]';
 v_captured timestamptz; v_on_at timestamptz; v_late boolean:=false; v_status text;
 v_partial boolean; v_refused jsonb:='[]'; v_msg text; v_state text; i integer;
begin
 v_load:=public.logistics_load(p_project_id,public.logistics_id(p_payload,'loadId','Load'));
 v_captured:=public.logistics_captured(p_payload);
 v_on_at:=coalesce(v_captured,now());
 v_partial:=public.logistics_flag(p_payload,'partial','Partial');
 if v_load.status in ('delivered','closed','cancelled') then
  raise exception 'Load % is finished',v_load.load_number using errcode='22023';
 end if;
 if nullif(p_payload->>'stopId','') is not null then
  if v_load.status<>'in_transit' then
   raise exception 'Until the truck leaves, scan pieces on without choosing a stop' using errcode='22023';
  end if;
  v_at:=public.logistics_stop(v_load,public.logistics_id(p_payload,'stopId','Stop'),'the stop');
  if v_at.kind='dropoff' then
   raise exception '% is a drop-off stop; nothing is picked up there',public.logistics_stop_name(v_at) using errcode='22023';
  end if;
  if v_at.status='done' then raise exception '% is already done',public.logistics_stop_name(v_at) using errcode='22023'; end if;
 elsif v_load.status='in_transit' then
  if v_captured is null or v_captured>v_load.departed_at+public.logistics_clock_slack() then
   raise exception 'Load % has left; choose the pick-up stop you''re at',v_load.load_number using errcode='22023';
  end if;
  v_late:=true;
 end if;

 -- Undo first, so a mistaken scan can be fixed in the same save.
 for v_code in select public.logistics_code(e) from jsonb_array_elements_text(public.logistics_list(p_payload,'undo','pieces to take off')) e loop
  begin
   select * into v_line from public.load_lines x where x.load_id=v_load.id and lower(x.tag)=lower(v_code) and x.status='on_board' for update;
   if not found then raise exception '% isn''t on the truck',v_code using errcode='22023'; end if;
   if v_line.pickup_stop_id is distinct from v_at.id then
    raise exception '% was loaded somewhere else; it comes off at a stop',v_code using errcode='22023';
   end if;
   update public.load_lines set status=case when added_in_field then 'removed' when v_late then 'not_loaded' else 'planned' end,
    on_by=null,on_at=null,unit_status_before=null where id=v_line.id;
   if v_line.unit_id is not null then
    update public.handling_units set status=coalesce(v_line.unit_status_before,'sealed') where id=v_line.unit_id;
   end if;
   v_off:=v_off||v_line.tag;
  exception when sqlstate '22023' or sqlstate '42501' or sqlstate '23505' then
   if not v_partial then raise; end if;
   get stacked diagnostics v_msg=message_text,v_state=returned_sqlstate;
   v_refused:=v_refused||jsonb_build_object('code',v_code,'list','undo','message',v_msg,'sqlstate',v_state);
  end;
 end loop;

 v_list:=public.logistics_list(p_payload,'pieces','pieces');
 for i in 0..jsonb_array_length(v_list)-1 loop
  v_elem:=v_list->i; v_from:=null;
  begin
   if jsonb_typeof(v_elem)='string' then
    v_elem:=jsonb_build_object('code',v_elem#>>'{}');
   elsif jsonb_typeof(v_elem)<>'object' then
    raise exception 'Each piece needs a code' using errcode='22023';
   end if;
   select * into v_piece from public.logistics_piece(p_project_id,v_elem->>'code',true);
   select * into v_line from public.load_lines x where x.load_id=v_load.id and x.status in ('planned','on_board','missing','not_loaded')
    and (x.unit_id=v_piece.unit_id or x.material_id=v_piece.material_id or x.inventory_uid=v_piece.inventory_uid)
    order by case x.status when 'on_board' then 0 when 'missing' then 1 when 'planned' then 2 else 3 end,x.created_at desc limit 1 for update;
   v_has:=found;
   -- A repeat scan of a piece already on changes nothing.
   if not (v_has and v_line.status in ('on_board','missing')) then
    if nullif(v_elem->>'dropoffStopId','') is not null then
     v_drop:=public.logistics_stop(v_load,public.logistics_id(v_elem,'dropoffStopId','Drop-off stop'),'where '||v_piece.tag||' comes off');
    elsif v_has then
     select * into v_drop from public.load_stops where id=v_line.dropoff_stop_id;
    else
     raise exception 'Choose where % comes off',v_piece.tag using errcode='22023';
    end if;
    if v_drop.kind='pickup' then
     raise exception '% is a pick-up stop; choose where % comes off',public.logistics_stop_name(v_drop),v_piece.tag using errcode='22023';
    end if;
    if v_drop.status='done' and not v_late then
     raise exception '% is already done; choose a later stop for %',public.logistics_stop_name(v_drop),v_piece.tag using errcode='22023';
    end if;
    if v_at.id is not null and v_drop.seq<=v_at.seq then
     raise exception '% has to come off at a stop after this one',v_piece.tag using errcode='22023';
    end if;
    if v_piece.unit_id is not null and v_piece.unit_status not in ('open','sealed','delivered') then
     raise exception '% is %; it can''t go on a load',v_piece.tag,replace(v_piece.unit_status,'_',' ') using errcode='22023';
    end if;
    v_status:=case when v_drop.status='done' then 'missing' else 'on_board' end;
    if v_late and exists(select 1 from public.load_lines y where y.load_id<>v_load.id
      and (y.unit_id=v_piece.unit_id or y.material_id=v_piece.material_id or y.inventory_uid=v_piece.inventory_uid)
      and y.status in ('on_board','delivered','missing','written_off')
      and coalesce(y.off_at,y.on_at,y.updated_at)>v_captured+public.logistics_clock_slack()) then
     raise exception '% traveled on another load after this scan was made; the scan is out of date',v_piece.tag using errcode='22023';
    end if;
    if not v_has or v_line.status='not_loaded' then
     v_from:=public.logistics_take_piece(v_load.id,v_piece.unit_id,v_piece.material_id,v_piece.inventory_uid,v_piece.tag,
      public.logistics_flag(v_elem,'move','Move'),false);
    end if;
    if v_has then
     update public.load_lines set status=v_status,dropoff_stop_id=v_drop.id,pickup_stop_id=v_at.id,unit_status_before=v_piece.unit_status,
      on_by=p_actor,on_at=v_on_at where id=v_line.id;
    else
     insert into public.load_lines(project_id,load_id,unit_id,material_id,inventory_uid,tag,pickup_stop_id,dropoff_stop_id,status,added_in_field,
      unit_status_before,planned_by,on_by,on_at)
     values(p_project_id,v_load.id,v_piece.unit_id,v_piece.material_id,v_piece.inventory_uid,v_piece.tag,v_at.id,v_drop.id,v_status,true,
      v_piece.unit_status,p_actor,p_actor,v_on_at);
    end if;
    if v_piece.unit_id is not null then
     update public.handling_units set status=case when v_status='missing' then 'missing' else 'on_load' end where id=v_piece.unit_id;
    end if;
    if v_from is not null then v_moved:=v_moved||jsonb_build_object('code',v_piece.tag,'from',v_from); end if;
    v_on:=v_on||v_piece.tag;
   end if;
  exception when sqlstate '22023' or sqlstate '42501' or sqlstate '23505' then
   if not v_partial then raise; end if;
   get stacked diagnostics v_msg=message_text,v_state=returned_sqlstate;
   v_refused:=v_refused||jsonb_build_object('code',coalesce(v_elem->>'code',v_list->>i),'list','pieces','message',v_msg,'sqlstate',v_state);
  end;
 end loop;

 if v_load.status='planning' and exists(select 1 from public.load_lines x where x.load_id=v_load.id and x.status='on_board') then
  update public.loads set status='loading' where id=v_load.id;
 end if;
 if v_at.id is not null and v_at.status='pending' and cardinality(v_on)>0 then
  update public.load_stops set status='arrived',arrived_at=v_on_at,arrived_source='scan' where id=v_at.id;
 end if;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(p_actor,'load_loaded','load',v_load.id,jsonb_build_object('operation_id',p_operation_id,'stop_id',v_at.id,'on',to_jsonb(v_on),'undone',to_jsonb(v_off),
   'moved_from',v_moved,'refused',v_refused,'captured_at',v_captured,'before_departure',v_late),p_project_id);
 return public.logistics_load_summary(v_load.id)||jsonb_build_object('refused',v_refused,'moved',v_moved);
end $$;

-- logistics_load_depart, from 022_loads_and_drivers.sql
create or replace function public.logistics_load_depart(p_actor uuid,p_operation_id uuid,p_project_id uuid,p_payload jsonb) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare v_load public.loads; v_line public.load_lines; v_piece record; v_confirm boolean; v_confirmed integer:=0; v_left integer;
 v_office boolean:=public.is_office_user(); v_origin_kind text; v_reason text; v_captured timestamptz;
begin
 v_load:=public.logistics_load(p_project_id,public.logistics_id(p_payload,'loadId','Load'));
 if v_load.status not in ('planning','loading') then
  raise exception 'Load % has already left',v_load.load_number using errcode='22023';
 end if;
 v_confirm:=public.logistics_flag(p_payload,'confirmAll','Confirm all');
 v_captured:=public.logistics_captured(p_payload);
 if v_confirm then
  if not v_office then
   raise exception 'Only office staff can mark pieces loaded without scanning them' using errcode='42501';
  end if;
  select p.kind into v_origin_kind from public.places p where p.id=v_load.origin_place_id;
  if v_origin_kind is null or v_origin_kind not in ('outside_shop','vendor') then
   raise exception 'Confirm without scanning is only for a load leaving an outside shop or vendor; at our yards and sites the crew scans' using errcode='22023';
  end if;
 end if;
 if v_load.driver_name is null then
  raise exception 'Add the driver''s name before load % leaves',v_load.load_number using errcode='22023';
 end if;
 if not (exists(select 1 from public.load_driver_licences d where d.load_id=v_load.id and d.licence_number is not null)
   and exists(select 1 from public.driver_licence_photos p where p.load_id=v_load.id and p.removed_at is null)) then
  v_reason:=public.logistics_text(p_payload,'overrideReason',500,'Reason');
  if v_reason is null then
   raise exception 'Record the driver''s license number and a photo of it before load % leaves',v_load.load_number using errcode='22023';
  end if;
  if not v_office then
   raise exception 'Only office staff can let a load leave without the driver''s license' using errcode='42501';
  end if;
  if length(v_reason)<5 then raise exception 'Give a reason of at least 5 characters' using errcode='22023'; end if;
 end if;
 if v_confirm then
  for v_line in select * from public.load_lines x where x.load_id=v_load.id and x.status='planned' and x.pickup_stop_id is null for update loop
   select * into v_piece from public.logistics_piece(p_project_id,v_line.tag,true);
   if v_piece.unit_id is not null and v_piece.unit_status not in ('open','sealed','delivered') then
    raise exception '% is %; it can''t go on a load',v_piece.tag,replace(v_piece.unit_status,'_',' ') using errcode='22023';
   end if;
   update public.load_lines set status='on_board',unit_status_before=v_piece.unit_status,on_by=p_actor,on_at=now() where id=v_line.id;
   if v_line.unit_id is not null then
    update public.handling_units set status='on_load' where id=v_line.unit_id;
   end if;
   v_confirmed:=v_confirmed+1;
  end loop;
 end if;
 if not exists(select 1 from public.load_lines x where x.load_id=v_load.id and x.status='on_board') then
  raise exception 'Nothing is on the truck yet' using errcode='22023';
 end if;
 update public.load_lines set status='not_loaded' where load_id=v_load.id and status='planned' and pickup_stop_id is null;
 get diagnostics v_left=row_count;
 update public.loads set status='in_transit',departed_at=coalesce(v_captured,now()),departed_by=p_actor,
  licence_override_reason=v_reason,licence_override_by=case when v_reason is not null then p_actor end,
  licence_override_at=case when v_reason is not null then now() end
 where id=v_load.id;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(p_actor,'load_departed','load',v_load.id,jsonb_build_object('operation_id',p_operation_id,'confirmed',v_confirmed,'not_loaded',v_left,
   'licence_override',v_reason is not null),p_project_id);
 return public.logistics_load_summary(v_load.id)||jsonb_build_object('not_loaded',v_left);
end $$;

-- logistics_load_off, from 022_loads_and_drivers.sql
create or replace function public.logistics_load_off(p_actor uuid,p_operation_id uuid,p_project_id uuid,p_payload jsonb) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare
 v_load public.loads; v_stop public.load_stops; v_place public.places; v_piece record; v_line public.load_lines; v_has boolean; v_skip boolean;
 v_other text; v_flag text; v_code text; v_map uuid; v_zone uuid; v_pos record; v_captured timestamptz; v_off_at timestamptz;
 v_done integer:=0; v_extra integer:=0; v_wrong integer:=0; v_corrected integer:=0; v_tags text[]:='{}';
 v_partial boolean; v_refused jsonb:='[]'; v_msg text; v_state text;
begin
 v_load:=public.logistics_load(p_project_id,public.logistics_id(p_payload,'loadId','Load'));
 if v_load.status in ('planning','loading') then
  raise exception 'Load % hasn''t left yet',v_load.load_number using errcode='22023';
 end if;
 if v_load.status in ('closed','cancelled') then
  raise exception 'Load % is %',v_load.load_number,replace(v_load.status,'cancelled','canceled') using errcode='22023';
 end if;
 v_stop:=public.logistics_stop(v_load,public.logistics_id(p_payload,'stopId','Stop'),'the stop the pieces come off at');
 select * into v_place from public.places where id=v_stop.place_id;
 v_map:=public.logistics_id(p_payload,'siteMapId','Site plan');
 v_zone:=public.logistics_id(p_payload,'zoneId','Area');
 v_captured:=public.logistics_captured(p_payload);
 v_off_at:=coalesce(v_captured,now());
 v_partial:=public.logistics_flag(p_payload,'partial','Partial');
 if v_map is not null or v_zone is not null then
  select * into v_pos from public.logistics_position(p_project_id,v_place.id,v_map,v_zone,false);
 else
  select v_place.id as place_id,null::uuid as site_map_id,null::uuid as zone_id,null::text as location into v_pos;
 end if;
 for v_code in select e from jsonb_array_elements_text(public.logistics_list(p_payload,'pieces','pieces')) e loop
  begin
   v_skip:=false;
   select * into v_piece from public.logistics_piece(p_project_id,v_code,false);
   select * into v_line from public.load_lines x where x.load_id=v_load.id
    and (x.unit_id=v_piece.unit_id or x.material_id=v_piece.material_id or x.inventory_uid=v_piece.inventory_uid)
    order by (x.status in ('on_board','missing','delivered')) desc,x.created_at desc limit 1 for update;
   v_has:=found;
   if v_has and v_line.status='delivered' then
    -- Already off: a scan here (newer than the one recorded) corrects the stop.
    if v_line.delivered_stop_id is not distinct from v_stop.id or v_captured<v_line.off_at-public.logistics_clock_slack() then
     v_skip:=true;
    else
     -- Only where it last came off can be corrected, not once it has moved on.
     select o.load_number into v_other from public.logistics_open_line(v_piece.unit_id,v_piece.material_id,v_piece.inventory_uid,v_load.id) o;
     if v_other is not null then
      raise exception '% is on load % now; it can''t come off this load again',v_piece.tag,v_other using errcode='22023';
     end if;
     if exists(select 1 from public.load_lines y where y.id<>v_line.id and y.created_at>v_line.created_at
       and y.status in ('on_board','delivered','missing','written_off')
       and (y.unit_id=v_piece.unit_id or y.material_id=v_piece.material_id or y.inventory_uid=v_piece.inventory_uid)) then
      raise exception '% has traveled on another load since it came off here',v_piece.tag using errcode='22023';
     end if;
     if v_piece.unit_id is not null and v_piece.unit_status<>'delivered' then
      raise exception '% is % now; it can''t come off this load again',v_piece.tag,replace(v_piece.unit_status,'_',' ') using errcode='22023';
     end if;
     v_flag:=case when v_line.flag='extra' then 'extra' when v_line.dropoff_stop_id<>v_stop.id then 'wrong_stop'
      when v_line.flag='wrong_stop' then null else v_line.flag end;
     update public.load_lines set flag=v_flag,delivered_stop_id=v_stop.id,delivered_place_id=v_place.id,delivered_source='scan',
      off_by=p_actor,off_at=v_off_at where id=v_line.id;
     v_corrected:=v_corrected+1;
     if v_flag='wrong_stop' then v_wrong:=v_wrong+1; end if;
    end if;
   elsif v_has and v_line.status in ('on_board','missing') then
    v_flag:=case when v_line.dropoff_stop_id<>v_stop.id then 'wrong_stop' when v_line.status='missing' then 'found' end;
    update public.load_lines set status='delivered',flag=coalesce(v_flag,flag),delivered_stop_id=v_stop.id,delivered_place_id=v_place.id,
     delivered_source='scan',off_by=p_actor,off_at=v_off_at where id=v_line.id;
    if v_flag='wrong_stop' then v_wrong:=v_wrong+1; end if;
   else
    -- The records didn't have it on this truck: an extra piece.
    select o.load_number into v_other from public.logistics_open_line(v_piece.unit_id,v_piece.material_id,v_piece.inventory_uid,v_load.id) o;
    if v_other is not null then raise exception '% belongs to load %',v_piece.tag,v_other using errcode='22023'; end if;
    if v_piece.unit_id is not null and v_piece.unit_status not in ('open','sealed','delivered') then
     raise exception '% is %; it can''t be unloaded here',v_piece.tag,replace(v_piece.unit_status,'_',' ') using errcode='22023';
    end if;
    if v_has then
     update public.load_lines set status='delivered',flag='extra',delivered_stop_id=v_stop.id,delivered_place_id=v_place.id,
      delivered_source='scan',off_by=p_actor,off_at=v_off_at where id=v_line.id;
    else
     insert into public.load_lines(project_id,load_id,unit_id,material_id,inventory_uid,tag,dropoff_stop_id,status,flag,added_in_field,
      delivered_stop_id,delivered_place_id,delivered_source,planned_by,off_by,off_at)
     values(p_project_id,v_load.id,v_piece.unit_id,v_piece.material_id,v_piece.inventory_uid,v_piece.tag,v_stop.id,'delivered','extra',true,
      v_stop.id,v_place.id,'scan',p_actor,p_actor,v_off_at);
    end if;
    v_extra:=v_extra+1;
   end if;
   if not v_skip then
    if v_piece.unit_id is not null then
     update public.handling_units set status='delivered',place_id=v_pos.place_id,site_map_id=v_pos.site_map_id,zone_id=v_pos.zone_id,location=v_pos.location
      where id=v_piece.unit_id;
    else
     perform public.logistics_place_item(p_actor,v_piece.material_id,v_piece.inventory_uid,v_pos.place_id,v_pos.site_map_id,v_pos.zone_id,
      v_pos.location,'Unloaded from '||v_load.load_number);
    end if;
    v_done:=v_done+1;
    v_tags:=v_tags||v_piece.tag;
   end if;
  exception when sqlstate '22023' or sqlstate '42501' or sqlstate '23505' then
   if not v_partial then raise; end if;
   get stacked diagnostics v_msg=message_text,v_state=returned_sqlstate;
   v_refused:=v_refused||jsonb_build_object('code',v_code,'message',v_msg,'sqlstate',v_state);
  end;
 end loop;
 if v_stop.status='pending' and v_done>0 then
  update public.load_stops set status='arrived',arrived_at=v_off_at,arrived_source='scan' where id=v_stop.id;
 end if;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(p_actor,'load_unloaded','load',v_load.id,jsonb_build_object('operation_id',p_operation_id,'stop_id',v_stop.id,'pieces',to_jsonb(v_tags),
   'corrected',v_corrected,'refused',v_refused,'captured_at',v_captured),p_project_id);
 return jsonb_build_object('load_id',v_load.id,'stop_id',v_stop.id,'delivered',v_done,'extra',v_extra,'wrong_stop',v_wrong,
  'corrected',v_corrected,'refused',v_refused);
end $$;

-- logistics_load_close, from 022_loads_and_drivers.sql
create or replace function public.logistics_load_close(p_actor uuid,p_operation_id uuid,p_project_id uuid,p_payload jsonb) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare v_load public.loads; v_line public.load_lines; v_cancel boolean; v_open integer;
begin
 if not public.is_office_user() then
  raise exception 'Only office staff can close or cancel a load' using errcode='42501';
 end if;
 v_load:=public.logistics_load(p_project_id,public.logistics_id(p_payload,'loadId','Load'));
 v_cancel:=public.logistics_flag(p_payload,'cancel','Cancel');
 if v_cancel then
  if v_load.status not in ('planning','loading') then
   raise exception 'Only a load that hasn''t left can be canceled' using errcode='22023';
  end if;
  for v_line in select * from public.load_lines x where x.load_id=v_load.id and x.status='on_board' and x.unit_id is not null for update loop
   update public.handling_units set status=coalesce(v_line.unit_status_before,'sealed') where id=v_line.unit_id;
  end loop;
  update public.load_lines set status='removed' where load_id=v_load.id and status in ('planned','on_board');
  update public.loads set status='cancelled',closed_at=now(),closed_by=p_actor where id=v_load.id;
 else
  if v_load.status<>'delivered' then
   raise exception 'Finish every stop of load % before closing it',v_load.load_number using errcode='22023';
  end if;
  select count(*) into v_open from public.load_lines x where x.load_id=v_load.id and x.status in ('on_board','missing');
  if v_open>0 then
   raise exception 'Load % still has missing pieces (%); scan them, mark them found or write them off first',v_load.load_number,v_open using errcode='22023';
  end if;
  update public.loads set status='closed',closed_at=now(),closed_by=p_actor where id=v_load.id;
 end if;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(p_actor,case when v_cancel then 'load_cancelled' else 'load_closed' end,'load',v_load.id,jsonb_build_object('operation_id',p_operation_id),p_project_id);
 return public.logistics_load_summary(v_load.id);
end $$;

-- record_driver_licence, from 022_loads_and_drivers.sql
create or replace function public.record_driver_licence(p_operation_id uuid,p_load_id uuid,p_licence jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); v_load public.loads; v_row public.load_driver_licences; v_op public.load_licence_operations;
 v_number text; v_state text; v_expiry date; v_captured timestamptz; v_last4 text;
begin
 if p_operation_id is null or jsonb_typeof(p_licence) is distinct from 'object' then
  raise exception 'Operation ID and license details are required' using errcode='22023';
 end if;
 select * into v_load from public.loads where id=p_load_id for update;
 if not found or actor is null or not public.can_work_project(v_load.project_id) then
  raise exception 'That load isn''t in your projects' using errcode='42501';
 end if;
 select * into v_op from public.load_licence_operations where operation_id=p_operation_id;
 if found then
  if v_op.load_id<>p_load_id or v_op.user_id<>actor then
   raise exception 'Operation ID already belongs to a different request' using errcode='23505';
  end if;
  return jsonb_build_object('load_id',p_load_id,'recorded',true);
 end if;
 if v_load.status in ('closed','cancelled') and not public.is_office_user() then
  raise exception 'Load % is closed; the office can still correct its license',v_load.load_number using errcode='22023';
 end if;
 if public.driver_licence_due_at(p_load_id)<now() then
  raise exception 'Load % is past its 90-day license retention period',v_load.load_number using errcode='22023';
 end if;
 v_captured:=public.logistics_captured(p_licence);
 select * into v_row from public.load_driver_licences where load_id=p_load_id for update;
 if found and v_captured<greatest(v_row.recorded_at,v_row.removed_at)-public.logistics_clock_slack() then
  raise exception 'The license for load % was changed after this was recorded; check it and record it again if needed',v_load.load_number using errcode='22023';
 end if;
 v_number:=upper(regexp_replace(btrim(coalesce(p_licence->>'number','')),'\s+',' ','g'));
 if v_number !~ '^[A-Z0-9][A-Z0-9 -]{2,39}$' then
  raise exception 'Enter the license number: 3 to 40 letters, numbers, spaces or dashes' using errcode='22023';
 end if;
 -- Only a long number's last four characters are ever repeated back or logged.
 v_last4:=case when length(regexp_replace(v_number,'[^A-Z0-9]','','g'))>6 then right(regexp_replace(v_number,'[^A-Z0-9]','','g'),4) end;
 v_state:=public.logistics_text(p_licence,'state',40,'Issuing state');
 v_expiry:=public.logistics_date(p_licence,'expiry','Expiration date');
 insert into public.load_driver_licences(load_id,project_id,licence_number,licence_state,licence_expiry,recorded_by,recorded_at)
 values(p_load_id,v_load.project_id,v_number,v_state,v_expiry,actor,coalesce(v_captured,now()))
 on conflict (load_id) do update set licence_number=excluded.licence_number,licence_state=excluded.licence_state,
  licence_expiry=excluded.licence_expiry,recorded_by=excluded.recorded_by,recorded_at=excluded.recorded_at,removed_at=null;
 insert into public.load_licence_operations(operation_id,load_id,project_id,user_id) values(p_operation_id,p_load_id,v_load.project_id,actor);
 update public.loads set licence_recorded_at=coalesce(v_captured,now()) where id=p_load_id;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(actor,'driver_licence_recorded','load',p_load_id,jsonb_build_object('operation_id',p_operation_id,'last4',v_last4),v_load.project_id);
 return jsonb_build_object('load_id',p_load_id,'recorded',true,'last4',v_last4);
end $$;

-- attach_driver_licence_photo, from 022_loads_and_drivers.sql
create or replace function public.attach_driver_licence_photo(p_load_id uuid,p_path text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); v_load public.loads;
begin
 select * into v_load from public.loads where id=p_load_id for update;
 if not found or actor is null or not public.can_work_project(v_load.project_id)
   or (v_load.status in ('closed','cancelled') and not public.is_office_user()) then
  raise exception 'License photos can''t be added to that load' using errcode='42501';
 end if;
 if coalesce(p_path,'') !~ ('^'||p_load_id::text||'/[A-Za-z0-9_-]{1,80}\.(jpg|jpeg|png)$') then
  raise exception 'License photos are stored as <load id>/<name>.jpg' using errcode='22023';
 end if;
 if not exists(select 1 from storage.objects o where o.bucket_id='driver-licences' and o.name=p_path) then
  raise exception 'Upload the photo before attaching it' using errcode='22023';
 end if;
 if exists(select 1 from public.driver_licence_photos p where p.storage_path=p_path) then return; end if;
 if (select count(*) from public.driver_licence_photos p where p.load_id=p_load_id and p.removed_at is null)>=4 then
  raise exception 'A load keeps at most 4 license photos' using errcode='22023';
 end if;
 insert into public.driver_licence_photos(load_id,project_id,storage_path,created_by) values(p_load_id,v_load.project_id,p_path,actor);
 update public.loads set licence_recorded_at=coalesce(licence_recorded_at,now()) where id=p_load_id;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(actor,'driver_licence_photo_added','load',p_load_id,jsonb_build_object('photo',split_part(p_path,'/',2)),v_load.project_id);
end $$;

-- remove_driver_licence_photo, from 022_loads_and_drivers.sql
create or replace function public.remove_driver_licence_photo(p_path text,p_reason text default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_photo public.driver_licence_photos;
begin
 select * into v_photo from public.driver_licence_photos where storage_path=p_path for update;
 if not found or not public.is_office_user() or not public.has_project_access(v_photo.project_id) then
  raise exception 'Only office staff on the load''s project can remove its license photos' using errcode='42501';
 end if;
 if v_photo.removed_at is not null then return; end if;
 if exists(select 1 from storage.objects o where o.bucket_id='driver-licences' and o.name=p_path) then
  raise exception 'Delete the photo from storage first' using errcode='22023';
 end if;
 update public.driver_licence_photos set removed_at=now() where id=v_photo.id;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(auth.uid(),'driver_licence_photo_removed','load',v_photo.load_id,jsonb_build_object('photo',split_part(p_path,'/',2),
   'reason',left(nullif(btrim(coalesce(p_reason,'')),''),500)),v_photo.project_id);
end $$;

-- driver_licence_clear, from 022_loads_and_drivers.sql
create or replace function public.driver_licence_clear(p_load public.loads,p_actor uuid,p_reason text,p_source text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_photos integer; v_numbers integer;
begin
 if exists(select 1 from storage.objects o where o.bucket_id='driver-licences' and split_part(o.name,'/',1)=p_load.id::text) then
  raise exception 'Delete the license photos from storage first' using errcode='22023';
 end if;
 update public.driver_licence_photos set removed_at=now() where load_id=p_load.id and removed_at is null;
 get diagnostics v_photos=row_count;
 update public.load_driver_licences set licence_number=null,licence_state=null,licence_expiry=null,removed_at=now()
  where load_id=p_load.id and removed_at is null;
 get diagnostics v_numbers=row_count;
 update public.loads set licence_recorded_at=null where id=p_load.id and licence_recorded_at is not null;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(p_actor,'driver_licence_removed','load',p_load.id,jsonb_build_object('photos',v_photos,'licence',v_numbers>0,'reason',p_reason,'by',p_source),p_load.project_id);
 return jsonb_build_object('load_id',p_load.id,'photos_removed',v_photos,'licence_removed',v_numbers>0);
end $$;

-- remove_driver_licence, from 023_driver_licence_retention.sql
create or replace function public.remove_driver_licence(p_load_id uuid,p_reason text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_load public.loads; v_reason text:=nullif(btrim(coalesce(p_reason,'')),''); v_hold public.driver_licence_holds;
begin
 select * into v_load from public.loads where id=p_load_id for update;
 if not found or not public.is_office_user() or not public.has_project_access(v_load.project_id) then
  raise exception 'Only office staff on the load''s project can remove its license' using errcode='42501';
 end if;
 select * into v_hold from public.driver_licence_holds where load_id=p_load_id;
 if v_hold.load_id is not null then
  raise exception 'This license is being kept (%); release it first',v_hold.reason using errcode='22023';
 end if;
 if length(v_reason)>500 then raise exception 'Reason is too long (at most 500 characters)' using errcode='22023'; end if;
 if public.driver_licence_due_at(p_load_id)>now() and coalesce(length(v_reason),0)<5 then
  raise exception 'Give a reason to remove the license before it is due' using errcode='22023';
 end if;
 return public.driver_licence_clear(v_load,auth.uid(),v_reason,'office');
end $$;

-- purge_driver_licence, from 023_driver_licence_retention.sql
create or replace function public.purge_driver_licence(p_load_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_load public.loads;
begin
 select * into v_load from public.loads where id=p_load_id for update;
 if not found then raise exception 'That load doesn''t exist' using errcode='22023'; end if;
 if exists(select 1 from public.driver_licence_holds h where h.load_id=p_load_id) then
  raise exception 'The license for load % is being kept',v_load.load_number using errcode='22023';
 end if;
 if public.driver_licence_due_at(p_load_id)>=now() then
  raise exception 'The license for load % isn''t due for removal yet',v_load.load_number using errcode='22023';
 end if;
 return public.driver_licence_clear(v_load,null,null,'retention');
end $$;

-- keep_driver_licence, from 023_driver_licence_retention.sql
create or replace function public.keep_driver_licence(p_load_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_load public.loads; v_reason text:=nullif(btrim(coalesce(p_reason,'')),'');
begin
 select * into v_load from public.loads where id=p_load_id for update;
 if not found or not public.is_office_user() or not public.has_project_access(v_load.project_id) then
  raise exception 'Only office staff on the load''s project can keep its license' using errcode='42501';
 end if;
 if v_reason is null or length(v_reason) not between 5 and 500 then
  raise exception 'Give a reason of 5 to 500 characters for keeping the license' using errcode='22023';
 end if;
 insert into public.driver_licence_holds(load_id,project_id,reason,held_by) values(p_load_id,v_load.project_id,v_reason,auth.uid())
 on conflict (load_id) do update set reason=excluded.reason,held_by=excluded.held_by,held_at=now();
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(auth.uid(),'driver_licence_kept','load',p_load_id,jsonb_build_object('reason',v_reason),v_load.project_id);
 return jsonb_build_object('load_id',p_load_id,'kept',true,'due_at',public.driver_licence_due_at(p_load_id));
end $$;

-- release_driver_licence_hold, from 023_driver_licence_retention.sql
create or replace function public.release_driver_licence_hold(p_load_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_load public.loads; v_hold public.driver_licence_holds;
begin
 select * into v_load from public.loads where id=p_load_id for update;
 if not found or not public.is_office_user() or not public.has_project_access(v_load.project_id) then
  raise exception 'Only office staff on the load''s project can release its license' using errcode='42501';
 end if;
 delete from public.driver_licence_holds where load_id=p_load_id returning * into v_hold;
 if v_hold.load_id is not null then
  insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
   values(auth.uid(),'driver_licence_hold_released','load',p_load_id,jsonb_build_object('reason',v_hold.reason),v_load.project_id);
 end if;
 return jsonb_build_object('load_id',p_load_id,'kept',false,'due_at',public.driver_licence_due_at(p_load_id));
end $$;

COMMIT;
