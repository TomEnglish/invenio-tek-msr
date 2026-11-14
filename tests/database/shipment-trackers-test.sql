BEGIN;
\ir admin-fixtures.sql

-- Made-up shipments and trackers. Test Yard One has three shipments and three trackers; Test Yard Two, which no one
-- here works on, has one of each; Finished Job is a completed project everyone is on.
INSERT INTO public.projects(id,name,status) VALUES ('b3333333-3333-4333-8333-333333333333','Finished Job','completed');
INSERT INTO public.user_projects(user_id,project_id) SELECT id,'b3333333-3333-4333-8333-333333333333' FROM public.users;
INSERT INTO public.shipments(id,shipment_number,status,cargo_description,origin,destination,project_id) VALUES
 (801,'SHP-801','In Transit','Fuel pump skid','Port Arthur, TX','Freeport, TX','b1111111-1111-4111-8111-111111111111'),
 (802,'SHP-802','RTS','Cable drums','Baytown, TX','Freeport, TX','b1111111-1111-4111-8111-111111111111'),
 (803,'SHP-803','Delivered','Valve crate','Mobile, AL','Freeport, TX','b1111111-1111-4111-8111-111111111111'),
 (804,'SHP-804','In Transit','Other project','Tulsa, OK','Freeport, TX','b2222222-2222-4222-8222-222222222222'),
 (805,'SHP-805','In Transit','Finished job','Victoria, TX','Freeport, TX','b3333333-3333-4333-8333-333333333333'),
 (806,'SHP-806-SECRET','In Transit','Other project, second','Tulsa, OK','Freeport, TX','b2222222-2222-4222-8222-222222222222');
INSERT INTO public.samsara_trackers(id,name,last_latitude,last_longitude,last_seen_at,project_id) VALUES
 ('trk-1','Tracker One',29.88,-93.94,now(),'b1111111-1111-4111-8111-111111111111'),
 ('trk-2','Tracker Two',29.73,-94.98,now(),'b1111111-1111-4111-8111-111111111111'),
 ('trk-3','Tracker Three',null,null,null,'b1111111-1111-4111-8111-111111111111'),
 ('trk-9','Other Tracker',36.15,-95.99,now(),'b2222222-2222-4222-8222-222222222222'),
 ('trk-5','Finished Tracker',28.8,-97.0,now(),'b3333333-3333-4333-8333-333333333333');
-- A link in Test Yard Two, made the way only the database owner could.
INSERT INTO public.shipment_trackers(project_id,shipment_id,tracker_id) VALUES ('b2222222-2222-4222-8222-222222222222',804,'trk-9');

SET LOCAL ROLE authenticated;

-- Field workers see the links on their project and change none.
SELECT set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);
SELECT pg_temp.expect_error($q$SELECT public.link_shipment_tracker(801,'trk-1')$q$,'42501','field workers can''t link a tracker');
SELECT pg_temp.expect_error($q$SELECT public.unlink_shipment_tracker(801,'trk-1')$q$,'42501','field workers can''t unlink a tracker');
SELECT pg_temp.expect_error($q$INSERT INTO public.shipment_trackers(project_id,shipment_id,tracker_id) VALUES ('b1111111-1111-4111-8111-111111111111',801,'trk-1')$q$,
 '42501','no one adds a link directly');

-- Office staff: through the functions only.
SELECT set_config('request.jwt.claim.sub','01111111-1111-4111-8111-111111111111',true);
SELECT pg_temp.expect_error($q$INSERT INTO public.shipment_trackers(project_id,shipment_id,tracker_id) VALUES ('b1111111-1111-4111-8111-111111111111',801,'trk-1')$q$,
 '42501','a direct link would go unrecorded, so office staff can''t add one either');
DO $$ DECLARE r public.shipment_trackers; again public.shipment_trackers; BEGIN
 r:=public.link_shipment_tracker(801,'trk-1');
 PERFORM pg_temp.assert_true(r.shipment_id=801 AND r.tracker_id='trk-1' AND r.ended_at IS NULL AND r.linked_by='01111111-1111-4111-8111-111111111111'
  AND r.project_id='b1111111-1111-4111-8111-111111111111','office staff link a tracker to a shipment, and the link says who made it');
 again:=public.link_shipment_tracker(801,'trk-1');
 PERFORM pg_temp.assert_true(again.id=r.id,'linking the tracker a shipment already has changes nothing');
END $$;
SELECT pg_temp.expect_error($q$UPDATE public.shipment_trackers SET ended_at=now(),ended_reason='unlinked' WHERE shipment_id=801$q$,'42501','no one ends a link directly');
SELECT pg_temp.expect_error($q$DELETE FROM public.shipment_trackers WHERE shipment_id=801$q$,'42501','no one deletes a link');
SELECT pg_temp.expect_error($q$SELECT public.link_shipment_tracker(801,'trk-9')$q$,'22023','a tracker from another project can''t ride with this project''s shipment');
SELECT pg_temp.expect_error($q$SELECT public.link_shipment_tracker(801,'no-such-tracker')$q$,'22023','an unknown tracker is refused');
SELECT pg_temp.expect_error($q$SELECT public.link_shipment_tracker(804,'trk-9')$q$,'42501','not on a project the office user isn''t on');
SELECT pg_temp.expect_error($q$SELECT public.link_shipment_tracker(805,'trk-5')$q$,'42501','not on a completed project');
SELECT pg_temp.expect_error($q$SELECT public.link_shipment_tracker(999999,'trk-1')$q$,'42501','an unknown shipment is refused');

-- A second tracker replaces the first on the same shipment.
DO $$ DECLARE r public.shipment_trackers; BEGIN
 r:=public.link_shipment_tracker(801,'trk-2');
 PERFORM pg_temp.assert_true(r.tracker_id='trk-2','the new tracker is linked');
 PERFORM pg_temp.assert_true((SELECT count(*) FROM public.shipment_trackers WHERE shipment_id=801 AND ended_at IS NULL)=1,'a shipment has one tracker at a time');
 PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM public.shipment_trackers WHERE shipment_id=801 AND tracker_id='trk-1' AND ended_reason='replaced'
  AND ended_by='01111111-1111-4111-8111-111111111111' AND ended_at IS NOT NULL),'the first tracker''s link ends as replaced, and says who ended it');
 PERFORM pg_temp.assert_true((SELECT linked_at FROM public.shipment_trackers WHERE shipment_id=801 AND tracker_id='trk-2')
  >=(SELECT ended_at FROM public.shipment_trackers WHERE shipment_id=801 AND tracker_id='trk-1'),'the new link starts once the old one has ended');
END $$;

-- A tracker on another shipment moves only when asked.
DO $$ DECLARE state text; message text; BEGIN
 BEGIN
  PERFORM public.link_shipment_tracker(802,'trk-2');
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS state=RETURNED_SQLSTATE, message=MESSAGE_TEXT;
 END;
 PERFORM pg_temp.assert_true(state='23505' AND message='Tracker Tracker Two is on shipment SHP-801. Move it to this shipment?',
  'a tracker on another shipment isn''t taken off it unasked, and the refusal names that shipment');
END $$;
DO $$ DECLARE r public.shipment_trackers; BEGIN
 r:=public.link_shipment_tracker(802,'trk-2',true);
 PERFORM pg_temp.assert_true(r.shipment_id=802 AND r.tracker_id='trk-2','asked to, the tracker moves');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.shipment_trackers WHERE shipment_id=801 AND ended_at IS NULL),'the shipment it left has no tracker');
 PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM public.shipment_trackers WHERE shipment_id=801 AND tracker_id='trk-2' AND ended_reason='moved'),
  'its old link ends as moved');
 PERFORM pg_temp.assert_true((SELECT count(*) FROM public.shipment_trackers WHERE tracker_id='trk-2' AND ended_at IS NULL)=1,'a tracker rides with one shipment at a time');
END $$;

-- Unlinking names the tracker the office user saw.
SELECT pg_temp.expect_error($q$SELECT public.unlink_shipment_tracker(802,'trk-1')$q$,'40001','a tracker someone else linked meanwhile isn''t taken off unseen');
SELECT pg_temp.expect_error($q$SELECT public.unlink_shipment_tracker(801,'trk-2')$q$,'22023','a shipment with no tracker has nothing to unlink');
DO $$ DECLARE r public.shipment_trackers; BEGIN
 r:=public.unlink_shipment_tracker(802,'trk-2');
 PERFORM pg_temp.assert_true(r.ended_reason='unlinked' AND r.ended_by='01111111-1111-4111-8111-111111111111' AND r.ended_at IS NOT NULL,'the link ends as unlinked');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.shipment_trackers WHERE tracker_id='trk-2' AND ended_at IS NULL),'the tracker is free again');
END $$;
SELECT pg_temp.expect_error($q$SELECT public.unlink_shipment_tracker(802,'trk-2')$q$,'22023','a link can''t be ended twice');

-- Administrators link too, including a tracker that hasn't reported a position yet.
SELECT set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
DO $$ DECLARE r public.shipment_trackers; BEGIN
 r:=public.link_shipment_tracker(803,'trk-3');
 PERFORM pg_temp.assert_true(r.tracker_id='trk-3' AND r.linked_by='a1111111-1111-4111-8111-111111111111','administrators link trackers');
END $$;

-- Everyone on the project sees its links, and no one sees another project's.
SELECT set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);
DO $$ BEGIN
 PERFORM pg_temp.assert_true((SELECT count(*) FROM public.shipment_trackers WHERE project_id='b1111111-1111-4111-8111-111111111111')=4,
  'field workers read every link on their project, ended ones included');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.shipment_trackers WHERE project_id='b2222222-2222-4222-8222-222222222222'),
  'a project you aren''t on stays hidden');
END $$;
RESET ROLE;

-- What was recorded.
DO $$ DECLARE d jsonb; BEGIN
 PERFORM pg_temp.assert_true((SELECT count(*) FROM public.audit_log WHERE action='shipment_tracker_linked')=4,'each link is recorded once; linking the same tracker again isn''t');
 SELECT details INTO d FROM public.audit_log WHERE action='shipment_tracker_linked' AND details->>'tracker_id'='trk-1';
 PERFORM pg_temp.assert_true(d='{"shipment_id":801,"shipment_number":"SHP-801","tracker_id":"trk-1","tracker_name":"Tracker One"}'::jsonb,'a first link records the shipment and the tracker');
 SELECT details INTO d FROM public.audit_log WHERE action='shipment_tracker_linked' AND details->>'shipment_id'='801' AND details->>'tracker_id'='trk-2';
 PERFORM pg_temp.assert_true(d->>'replaced_tracker_id'='trk-1','a replacement records the tracker it replaced');
 SELECT details INTO d FROM public.audit_log WHERE action='shipment_tracker_linked' AND details->>'shipment_id'='802';
 PERFORM pg_temp.assert_true(d->>'moved_from_shipment_number'='SHP-801' AND (d->>'moved_from_shipment_id')::bigint=801 AND NOT d ? 'replaced_tracker_id',
  'a move records the shipment the tracker came from');
 SELECT details INTO d FROM public.audit_log WHERE action='shipment_tracker_unlinked';
 PERFORM pg_temp.assert_true(d='{"shipment_id":802,"shipment_number":"SHP-802","tracker_id":"trk-2","tracker_name":"Tracker Two"}'::jsonb,'an unlink records the shipment and the tracker');
 PERFORM pg_temp.assert_true((SELECT count(*) FROM public.audit_log WHERE action LIKE 'shipment_tracker_%' AND entity_type='shipment'
  AND project_id='b1111111-1111-4111-8111-111111111111')=5,'every change is recorded against the project');
END $$;

-- The database itself keeps one tracker per shipment and one shipment per tracker, and an ended link says why.
SELECT pg_temp.expect_error($q$INSERT INTO public.shipment_trackers(project_id,shipment_id,tracker_id) VALUES ('b1111111-1111-4111-8111-111111111111',803,'trk-1')$q$,
 '23505','a second tracker on a shipment is refused even outside the functions');
SELECT pg_temp.expect_error($q$INSERT INTO public.shipment_trackers(project_id,shipment_id,tracker_id) VALUES ('b1111111-1111-4111-8111-111111111111',801,'trk-3')$q$,
 '23505','a tracker on two shipments is refused even outside the functions');
SELECT pg_temp.expect_error($q$INSERT INTO public.shipment_trackers(project_id,shipment_id,tracker_id,ended_at) VALUES ('b1111111-1111-4111-8111-111111111111',801,'trk-1',now())$q$,
 '23514','an ended link says why it ended');

-- Crews read tracker changes in the project activity feed: the shipment is named and the tracker's name passed on.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);
DO $$ DECLARE d jsonb; BEGIN
 SELECT details INTO d FROM public.list_project_activity('b1111111-1111-4111-8111-111111111111') WHERE action='shipment_tracker_linked' AND subject='SHP-802';
 PERFORM pg_temp.assert_true(d='{"tracker_name":"Tracker Two","moved_from_shipment_number":"SHP-801"}'::jsonb,'a move names the tracker and where it came from');
 PERFORM pg_temp.assert_true((SELECT count(*) FROM public.list_project_activity('b1111111-1111-4111-8111-111111111111') WHERE action LIKE 'shipment_tracker_%')=5
  AND NOT EXISTS(SELECT 1 FROM public.list_project_activity('b1111111-1111-4111-8111-111111111111') WHERE action LIKE 'shipment_tracker_%' AND subject IS NULL),
  'every tracker change names its shipment');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.list_project_activity('b1111111-1111-4111-8111-111111111111') WHERE details ? 'tracker_id' OR details ? 'shipment_id'),
  'only the listed details are passed on');
END $$;
RESET ROLE;

-- A tracker the sync moves to another project leaves its shipment: the link ends as reassigned, recorded in its project.
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.samsara_trackers SET project_id='b2222222-2222-4222-8222-222222222222' WHERE id='trk-3';
DO $$ DECLARE d jsonb; BEGIN
 PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM public.shipment_trackers WHERE shipment_id=803 AND tracker_id='trk-3' AND ended_reason='reassigned' AND ended_by IS NULL),
  'the link ends when its tracker moves to another project');
 SELECT details INTO d FROM public.audit_log WHERE action='shipment_tracker_unlinked' AND details->>'tracker_id'='trk-3';
 PERFORM pg_temp.assert_true(d='{"shipment_id":803,"shipment_number":"SHP-803","tracker_id":"trk-3","tracker_name":"Tracker Three","reason":"The tracker moved to another project"}'::jsonb
  AND (SELECT project_id FROM public.audit_log WHERE action='shipment_tracker_unlinked' AND details->>'tracker_id'='trk-3')='b1111111-1111-4111-8111-111111111111',
  'and it is recorded, with why, in the project the link was in');
END $$;

-- A shipment moved to another project leaves its tracker the same way; a sync that leaves the project alone ends nothing.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','01111111-1111-4111-8111-111111111111',true);
SELECT public.link_shipment_tracker(801,'trk-1');
RESET ROLE;
UPDATE public.samsara_trackers SET name='Tracker One', last_seen_at=now(), project_id='b1111111-1111-4111-8111-111111111111' WHERE id='trk-1';
DO $$ BEGIN
 PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM public.shipment_trackers WHERE shipment_id=801 AND tracker_id='trk-1' AND ended_at IS NULL),
  'a tracker update that keeps its project keeps its link');
END $$;
UPDATE public.shipments SET project_id='b2222222-2222-4222-8222-222222222222' WHERE id=801;
DO $$ BEGIN
 PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM public.shipment_trackers WHERE shipment_id=801 AND tracker_id='trk-1' AND ended_reason='reassigned'
  AND ended_by='01111111-1111-4111-8111-111111111111'),'the link ends when its shipment moves to another project');
 PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM public.audit_log WHERE action='shipment_tracker_unlinked' AND details->>'reason'='The shipment moved to another project'
  AND details->>'shipment_number'='SHP-801' AND project_id='b1111111-1111-4111-8111-111111111111'),'recorded with why');
END $$;
UPDATE public.shipments SET project_id='b1111111-1111-4111-8111-111111111111' WHERE id=801;

-- A link that somehow reaches across projects is never moved, or named, from a project that can't see it.
INSERT INTO public.shipment_trackers(project_id,shipment_id,tracker_id) VALUES ('b2222222-2222-4222-8222-222222222222',806,'trk-2');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','01111111-1111-4111-8111-111111111111',true);
DO $$ DECLARE state text; message text; BEGIN
 BEGIN
  PERFORM public.link_shipment_tracker(802,'trk-2',true);
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS state=RETURNED_SQLSTATE, message=MESSAGE_TEXT;
 END;
 PERFORM pg_temp.assert_true(state='42501' AND message='Tracker Tracker Two is on a shipment in another project; take it off there first'
  AND position('SECRET' in message)=0,'refused without naming the other project''s shipment');
END $$;
RESET ROLE;
DO $$ BEGIN
 PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM public.shipment_trackers WHERE shipment_id=806 AND ended_at IS NULL),'and that link is left as it was');
END $$;

-- However they ended, no two links of one shipment, or of one tracker, overlap in time.
DO $$ BEGIN
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.shipment_trackers a JOIN public.shipment_trackers b ON a.id<b.id
  AND (a.shipment_id=b.shipment_id OR a.tracker_id=b.tracker_id)
  AND a.linked_at<coalesce(b.ended_at,'infinity') AND b.linked_at<coalesce(a.ended_at,'infinity')),'links never overlap');
END $$;

-- Entries whose shipment id isn't a plain number name no shipment, and don't stop the feed.
INSERT INTO public.audit_log(action,entity_type,details,project_id) VALUES
 ('legacy_note','shipment','{"shipment_id":"abc"}','b1111111-1111-4111-8111-111111111111'),
 ('legacy_note','shipment','{"shipment_id":"99999999999999999999"}','b1111111-1111-4111-8111-111111111111'),
 ('legacy_note','shipment','{"shipment_id":802}','b1111111-1111-4111-8111-111111111111');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);
DO $$ BEGIN
 PERFORM pg_temp.assert_true((SELECT array_agg(subject ORDER BY subject NULLS FIRST)::text FROM public.list_project_activity('b1111111-1111-4111-8111-111111111111')
  WHERE action='legacy_note')='{NULL,NULL,SHP-802}','odd ids name nothing; a plain one, as a number, still names its shipment');
END $$;
RESET ROLE;
ROLLBACK;
