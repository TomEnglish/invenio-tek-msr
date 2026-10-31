BEGIN;
\ir admin-fixtures.sql

-- Two links in Test Yard One; the second has a status history and a tracker.
-- A third is in Test Yard Two, which no one here works on, and a fourth in a
-- completed project everyone is on.
INSERT INTO public.projects(id,name,status) VALUES ('b3333333-3333-4333-8333-333333333333','Finished Job','completed');
INSERT INTO public.user_projects(user_id,project_id) SELECT id,'b3333333-3333-4333-8333-333333333333' FROM public.users;
INSERT INTO public.material_links(id,po_id,po_line_item,po_description,install_tag,install_discipline,quantity,uom,project_id) VALUES
 (901,'PO-1001',10,'Six-inch valve','V-101','Mechanical',2,'EA','b1111111-1111-4111-8111-111111111111'),
 (902,'PO-1002',20,'Cable tray','CT-7','Electrical',40,'FT','b1111111-1111-4111-8111-111111111111'),
 (903,'PO-1003',30,'Other project','X-1','Civil',1,'EA','b2222222-2222-4222-8222-222222222222'),
 (904,'PO-1004',40,'Finished job','Y-1','Steel',1,'EA','b3333333-3333-4333-8333-333333333333');
INSERT INTO public.material_status_history(link_id,old_status,new_status,changed_by,project_id)
 VALUES (902,'ordered','shipped','Office','b1111111-1111-4111-8111-111111111111');
INSERT INTO public.samsara_trackers(id,name,linked_material_id,project_id)
 VALUES ('trk-902','Tracker on the tray',902,'b1111111-1111-4111-8111-111111111111');

SET LOCAL ROLE authenticated;

-- Office staff: notes as before; PO and installation details, editing and deleting refused.
SELECT set_config('request.jwt.claim.sub','01111111-1111-4111-8111-111111111111',true);
DO $$ DECLARE n int; BEGIN
 UPDATE public.material_links SET notes='On the truck' WHERE id=901;
 GET DIAGNOSTICS n=ROW_COUNT;
 PERFORM pg_temp.assert_true(n=1,'office staff still change a link''s notes');
 DELETE FROM public.material_links WHERE id=901;
 GET DIAGNOSTICS n=ROW_COUNT;
 PERFORM pg_temp.assert_true(n=0,'no one deletes a link directly');
END $$;
SELECT pg_temp.expect_error($q$UPDATE public.material_links SET install_tag='V-999' WHERE id=901$q$,'42501','office staff can''t change an install tag directly');
SELECT pg_temp.expect_error($q$UPDATE public.material_links SET project_id='b2222222-2222-4222-8222-222222222222' WHERE id=901$q$,'42501','a link stays in its project');
SELECT pg_temp.expect_error($q$SELECT public.admin_update_material_link(901,'{"install_tag":"V-999"}','Tag was mistyped')$q$,'42501','office staff can''t edit a link');
SELECT pg_temp.expect_error($q$SELECT public.admin_delete_material_link(901,'Made in error')$q$,'42501','office staff can''t delete a link');

-- Field workers: nothing new.
SELECT set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);
SELECT pg_temp.expect_error($q$SELECT public.admin_update_material_link(901,'{"install_tag":"V-999"}','Tag was mistyped')$q$,'42501','field workers can''t edit a link');
SELECT pg_temp.expect_error($q$SELECT public.admin_delete_material_link(901,'Made in error')$q$,'42501','field workers can''t delete a link');

-- Administrators: through the functions only, with a reason.
SELECT set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
SELECT pg_temp.expect_error($q$UPDATE public.material_links SET install_tag='V-999' WHERE id=901$q$,'42501','a direct edit would go unrecorded, so it is refused for administrators too');
SELECT pg_temp.expect_error($q$SELECT public.admin_update_material_link(901,'{"install_tag":"V-999"}','typo')$q$,'22023','a reason is at least 5 characters');
SELECT pg_temp.expect_error($q$SELECT public.admin_update_material_link(901,'{"material_status":"installed"}','Wrong status')$q$,'22023','status changes stay with Update');
SELECT pg_temp.expect_error($q$SELECT public.admin_update_material_link(901,'{}','Nothing at all')$q$,'22023','an edit names a change');
SELECT pg_temp.expect_error($q$SELECT public.admin_update_material_link(901,'{"po_id":"  "}','Clear the PO')$q$,'22023','the PO number can''t be cleared');
SELECT pg_temp.expect_error($q$SELECT public.admin_update_material_link(901,'{"install_discipline":"Plumbing"}','New discipline')$q$,'22023','the discipline is one of the five');
SELECT pg_temp.expect_error($q$SELECT public.admin_update_material_link(901,'{"po_line_item":"ten"}','Line number fix')$q$,'22023','the PO line is a whole number');
SELECT pg_temp.expect_error($q$SELECT public.admin_update_material_link(901,'{"quantity":-1}','Quantity fix')$q$,'22023','a quantity isn''t negative');
SELECT pg_temp.expect_error($q$SELECT public.admin_update_material_link(901,'{"install_tag":{"tag":"V-1"}}','Nested value')$q$,'22023','a detail is text, a number or empty');
SELECT pg_temp.expect_error($q$SELECT public.admin_update_material_link(901,'{"install_tag":"V-101"}','Same tag again')$q$,'22023','an edit that changes nothing is refused');
SELECT pg_temp.expect_error($q$SELECT public.admin_update_material_link(903,'{"install_tag":"X-2"}','Other project link')$q$,'42501','not on a project the administrator isn''t on');
SELECT pg_temp.expect_error($q$SELECT public.admin_update_material_link(904,'{"install_tag":"Y-2"}','Finished project link')$q$,'42501','not on a completed project');
SELECT pg_temp.expect_error($q$SELECT public.admin_delete_material_link(904,'Finished project link')$q$,'42501','no deleting on a completed project');
SELECT pg_temp.expect_error($q$SELECT public.admin_delete_material_link(901,'typo')$q$,'22023','a delete needs a reason too');
DO $$ DECLARE r public.material_links; BEGIN
 r:=public.admin_update_material_link(901,'{"install_tag":" V-101A ","quantity":"3","po_description":""}','Tag was mistyped on the drawing');
 PERFORM pg_temp.assert_true(r.install_tag='V-101A' AND r.quantity=3 AND r.po_description IS NULL AND r.po_id='PO-1001'
  AND r.install_discipline='Mechanical' AND r.notes='On the truck','an edit changes only what it names, trimmed, and empty text clears');
END $$;
DO $$ DECLARE j jsonb; BEGIN
 j:=public.admin_delete_material_link(902,'Linked to the wrong PO');
 PERFORM pg_temp.assert_true(j='{"link_id":902,"status_history_removed":1,"trackers_unlinked":1}'::jsonb,'the delete says what went with the link');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.material_links WHERE id=902),'the link is gone');
END $$;
SELECT pg_temp.expect_error($q$SELECT public.admin_delete_material_link(902,'Linked to the wrong PO')$q$,'42501','a deleted link can''t be deleted again');
RESET ROLE;

-- What was recorded, and what the delete took with it.
DO $$ DECLARE e jsonb; d jsonb; BEGIN
 SELECT details INTO e FROM public.audit_log WHERE action='material_link_edited';
 PERFORM pg_temp.assert_true((e->>'link_id')::bigint=901 AND e->>'reason'='Tag was mistyped on the drawing'
  AND e->'before'->>'install_tag'='V-101' AND e->'after'->>'install_tag'='V-101A'
  AND (e->'before'->>'quantity')::numeric=2 AND (e->'after'->>'quantity')::numeric=3
  AND e->'before'->>'po_description'='Six-inch valve' AND e->'after'->'po_description'='null'::jsonb
  AND (SELECT count(*) FROM jsonb_object_keys(e->'after'))=3,'the edit''s record keeps the old and new values of what changed, and the reason');
 SELECT details INTO d FROM public.audit_log WHERE action='material_link_deleted';
 PERFORM pg_temp.assert_true((d->>'link_id')::bigint=902 AND d->'link'->>'po_id'='PO-1002' AND d->'link'->>'install_tag'='CT-7'
  AND jsonb_array_length(d->'status_history')=1 AND d->'status_history'->0->>'new_status'='shipped'
  AND d->'trackers_unlinked'='["trk-902"]'::jsonb AND d->>'reason'='Linked to the wrong PO','the delete''s record keeps the link, its history and its trackers');
 PERFORM pg_temp.assert_true((SELECT count(*) FROM public.audit_log WHERE action IN ('material_link_edited','material_link_deleted')
  AND user_id='a1111111-1111-4111-8111-111111111111' AND project_id='b1111111-1111-4111-8111-111111111111')=2,'both are recorded against the administrator and project');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.material_status_history WHERE link_id=902),'the status history went with the link');
 PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM public.samsara_trackers WHERE id='trk-902' AND linked_material_id IS NULL),'the tracker is unlinked, not deleted');
END $$;
ROLLBACK;
