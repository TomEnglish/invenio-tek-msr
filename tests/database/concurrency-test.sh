#!/usr/bin/env bash
set -euo pipefail
# This script is intentionally callable only from the disposable local harness.
test "${INVENIO_DISPOSABLE_DB:-}" = 1
test "${PGHOST:-}" = 127.0.0.1
task_concurrency_db="invenio_concurrency_$$"
createdb --maintenance-db=template1 --template="$PGDATABASE" "$task_concurrency_db"
trap 'dropdb --maintenance-db=template1 --if-exists --force "$task_concurrency_db" >/dev/null' EXIT
export PGDATABASE="$task_concurrency_db"

python3 <<'PY'
import os
import select
import subprocess
import time


def sql(statement):
    result = subprocess.run(
        ['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', statement],
        capture_output=True, text=True, timeout=15, check=True,
    )
    return result.stdout.strip()


class Session:
    def __init__(self, name):
        self.name = name
        self.process = subprocess.Popen(
            ['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=0'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            env={**os.environ, 'PGAPPNAME': name},
        )
        self.send("SET statement_timeout='10s';")

    def send(self, statement):
        self.process.stdin.write((statement + '\n').encode())
        self.process.stdin.flush()

    def until(self, marker):
        deadline = time.monotonic() + 12
        output = b''
        while marker.encode() not in output:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise AssertionError(f'{self.name} timed out awaiting {marker}: {output.decode()}')
            if not select.select([self.process.stdout], [], [], remaining)[0]:
                continue
            chunk = os.read(self.process.stdout.fileno(), 65536)
            if not chunk:
                raise AssertionError(f'{self.name} exited before {marker}: {output.decode()}')
            output += chunk
        return output.decode()

    def close(self):
        if self.process.poll() is None:
            self.send('ROLLBACK;\n\\q')
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()


def wait_until_blocked(name):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        blocked = sql(f"SELECT count(*) FROM pg_stat_activity WHERE application_name='{name}' AND cardinality(pg_blocking_pids(pid))>0")
        if blocked == '1':
            return
        time.sleep(0.02)
    raise AssertionError(f'{name} did not overlap and wait on the first transaction')


def overlap(label, first_statement, second_statement, expected_second):
    first = Session('invenio-test-first')
    second = Session('invenio-test-second')
    try:
        first.send('BEGIN;\n' + first_statement + '\n\\echo FIRST_READY :SQLSTATE')
        first_output = first.until('FIRST_READY')
        assert 'FIRST_READY 00000' in first_output, first_output
        second.send('BEGIN;\n' + second_statement + '\n\\echo SECOND_DONE :SQLSTATE')
        wait_until_blocked(second.name)
        first.send('COMMIT;\n\\echo FIRST_COMMITTED :SQLSTATE')
        assert 'FIRST_COMMITTED 00000' in first.until('FIRST_COMMITTED')
        second_output = second.until('SECOND_DONE')
        assert f'SECOND_DONE {expected_second}' in second_output, second_output
        second.send(('COMMIT;' if expected_second == '00000' else 'ROLLBACK;') + '\n\\echo SECOND_FINISHED')
        second.until('SECOND_FINISHED')
        print(f'Concurrency passed: {label}', flush=True)
    finally:
        first.close()
        second.close()


# Tests use a clone of the migrated disposable database. This allows committed
# fixtures visible in independent sessions while dropdb removes all test state.
sql("""
INSERT INTO auth.users(id,email) VALUES
 ('a1111111-1111-4111-8111-111111111111','race-admin-one@example.test'),
 ('a2222222-2222-4222-8222-222222222222','race-admin-two@example.test'),
 ('f1111111-1111-4111-8111-111111111111','race-worker@example.test');
UPDATE public.users SET invitation_status='accepted';
UPDATE public.users SET role='admin' WHERE email LIKE 'race-admin-%';
INSERT INTO public.projects(id,name) VALUES('b1111111-1111-4111-8111-111111111111','Concurrency Yard');
INSERT INTO public.user_projects(user_id,project_id)
 SELECT id,'b1111111-1111-4111-8111-111111111111' FROM public.users;
""")
overlap(
    'simultaneous self-demotions preserve one active administrator',
    "SET LOCAL ROLE service_role; SELECT public.admin_update_user('a1111111-1111-4111-8111-111111111111','a1111111-1111-4111-8111-111111111111','{\"role\":\"office_staff\"}');",
    "SET LOCAL ROLE service_role; SELECT public.admin_update_user('a2222222-2222-4222-8222-222222222222','a2222222-2222-4222-8222-222222222222','{\"role\":\"office_staff\"}');",
    '23514',
)
assert sql("SELECT count(*) FROM public.users WHERE role='admin' AND is_active AND invitation_status='accepted'") == '1'
assert sql('SELECT count(*) FROM public.user_admin_audit') == '1'

sql("""
INSERT INTO public.qr_codes(id,project_id,code_value,entity_type) VALUES
 ('d1111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111','CONCURRENT-QR','item');
INSERT INTO public.receiving_records(id,project_id,qr_code_id,material_type,qty,created_by) VALUES
 ('e1111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111',
  'd1111111-1111-4111-8111-111111111111','Steel',10,'f1111111-1111-4111-8111-111111111111');
INSERT INTO public.materials(id,project_id,receiving_record_id,qr_code_id,material_type,qty,current_quantity) VALUES
 ('e2222222-2222-4222-8222-222222222222','b1111111-1111-4111-8111-111111111111',
 'e1111111-1111-4111-8111-111111111111','d1111111-1111-4111-8111-111111111111','Steel',10,10);
""")


def issue(operation, quantity, job):
    return f"""SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);
SELECT public.apply_field_operation('{operation}','b1111111-1111-4111-8111-111111111111','issue',
 '{{"materialId":"e2222222-2222-4222-8222-222222222222","jobNumber":"{job}","quantity":{quantity}}}');"""


overlap(
    'competing issues cannot allocate more stock than exists',
    issue('20000000-0000-4000-8000-000000000001', 6, 'RACE-A'),
    issue('20000000-0000-4000-8000-000000000002', 6, 'RACE-B'),
    '22023',
)
assert sql("SELECT current_quantity FROM public.materials WHERE id='e2222222-2222-4222-8222-222222222222'") == '4'
assert sql('SELECT sum(quantity_issued) FROM public.material_issues') == '6'
assert sql('SELECT count(*) FROM public.field_operations') == '1'

same_request = issue('20000000-0000-4000-8000-000000000003', 2, 'REPLAY')
overlap('simultaneous identical operation deducts inventory only once', same_request, same_request, '00000')
assert sql("SELECT current_quantity FROM public.materials WHERE id='e2222222-2222-4222-8222-222222222222'") == '2'
assert sql("SELECT count(*) FROM public.material_issues WHERE job_number='REPLAY'") == '1'
assert sql('SELECT count(*) FROM public.field_operations') == '2'
assert sql("SELECT count(*) FROM public.audit_log WHERE action='material_issued'") == '2'


def import_snapshot(project, po_number, net_value, shipment, status):
    return f"""SET LOCAL ROLE service_role;
SELECT public.import_po_shipment_snapshot('{project}',
 '[{{"purchase_order_id":"{po_number}","purchase_order_item":"00010","net_value":{net_value},"status":"Sent"}}]',
 '[{{"shipment_number":"{shipment}","po_number":"{po_number}","num_pieces":1,"status":"{status}"}}]');"""


first_project = 'b1111111-1111-4111-8111-111111111111'
second_project = 'b2222222-2222-4222-8222-222222222222'
overlap(
    'same-project imports serialize and aggregate both retained snapshots',
    import_snapshot(first_project, 'RACE-PO-FIRST', 30, 'RACE-SHIP-FIRST', 'In Transit'),
    import_snapshot(first_project, 'RACE-PO-SECOND', 70, 'RACE-SHIP-SECOND', 'Delivered'),
    '00000',
)
assert sql(f"SELECT count(*) FROM public.purchase_orders WHERE project_id='{first_project}'") == '2'
assert sql(f"SELECT count(*) FROM public.shipments WHERE project_id='{first_project}'") == '2'
assert sql(f"""SELECT count(*)=1 AND bool_and(
 (procurement->>'total_pos')::integer=2 AND (procurement->>'total_po_value')::numeric=100
 AND (procurement->>'total_shipments')::integer=2 AND (procurement->>'delivered_shipments')::integer=1
 AND (procurement->>'in_transit_shipments')::integer=1)
 FROM public.dashboard_metrics WHERE project_id='{first_project}'""") == 't'

sql(f"""
INSERT INTO public.projects(id,name) VALUES('{second_project}','Other Import Yard');
INSERT INTO public.purchase_orders(project_id,purchase_order_id,purchase_order_item,net_value,item_description)
 VALUES('{second_project}','RACE-PO-LOSER','00010',17,'Preserve this description');
INSERT INTO public.dashboard_metrics(project_id,project_name,procurement,installation,status_counts)
 VALUES('{second_project}','Other Import Yard','{{"total_pos":1,"total_po_value":17}}',
 '{{"total_items":9}}','{{"po_status":{{"Sent":1}}}}');
""")


def project_import_state(project):
    return sql(f"""SELECT jsonb_build_object(
 'purchase_orders',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM public.purchase_orders p WHERE project_id='{project}'),
 'shipments',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM public.shipments s WHERE project_id='{project}'),
 'dashboard_metrics',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY id),'[]') FROM public.dashboard_metrics m WHERE project_id='{project}'))""")


loser_before = project_import_state(second_project)
overlap(
    'concurrent cross-project shipment collision rolls back the losing PO and metrics',
    import_snapshot(first_project, 'RACE-PO-WINNER', 5, 'RACE-SHIP-SHARED', 'Delivered'),
    import_snapshot(second_project, 'RACE-PO-LOSER', 9999, 'RACE-SHIP-SHARED', 'In Transit'),
    '22023',
)
assert project_import_state(second_project) == loser_before
assert sql("SELECT project_id FROM public.shipments WHERE shipment_number='RACE-SHIP-SHARED'") == first_project
assert sql(f"""SELECT count(*)=1 AND bool_and(
 (procurement->>'total_pos')::integer=3 AND (procurement->>'total_po_value')::numeric=105
 AND (procurement->>'total_shipments')::integer=3 AND (procurement->>'delivered_shipments')::integer=2)
 FROM public.dashboard_metrics WHERE project_id='{first_project}'""") == 't'

# Area-tree edits on a plan take turns, so crossing moves cannot make a loop
# and an area cannot change plans while a sub-area is being added to it.
plan_one, plan_two = '5c111111-1111-4111-8111-111111111111', '5c222222-2222-4222-8222-222222222222'
north, south = '2c111111-1111-4111-8111-111111111111', '2c222222-2222-4222-8222-222222222222'
east, west = '2c333333-3333-4333-8333-333333333333', '2c444444-4444-4444-8444-444444444444'
sql(f"""
INSERT INTO public.site_maps(id,project_id,name) VALUES
 ('{plan_one}','{first_project}','Race plan one'),('{plan_two}','{first_project}','Race plan two');
INSERT INTO public.site_map_zones(id,map_id,project_id,name,shape) VALUES
 ('{north}','{plan_one}','{first_project}','North','[[0,0],[1,0],[1,1]]'),
 ('{south}','{plan_one}','{first_project}','South','[[0,0],[1,0],[1,1]]'),
 ('{east}','{plan_one}','{first_project}','East','[[0,0],[1,0],[1,1]]'),
 ('{west}','{plan_one}','{first_project}','West','[[0,0],[1,0],[1,1]]');
""")
overlap(
    'crossing area moves cannot make a loop',
    f"UPDATE public.site_map_zones SET parent_id='{south}' WHERE id='{north}';",
    f"UPDATE public.site_map_zones SET parent_id='{north}' WHERE id='{south}';",
    '22023',
)
assert sql(f"SELECT parent_id IS NULL FROM public.site_map_zones WHERE id='{south}'") == 't'
overlap(
    'a sub-area cannot be added to an area that is moving to another plan',
    f"UPDATE public.site_map_zones SET map_id='{plan_two}' WHERE id='{east}';",
    f"INSERT INTO public.site_map_zones(map_id,project_id,parent_id,name,shape) VALUES('{plan_one}','{first_project}','{east}','East child','[[0,0],[1,0],[1,1]]');",
    '42501',
)
overlap(
    'an area cannot move to another plan while a sub-area is added to it',
    f"INSERT INTO public.site_map_zones(map_id,project_id,parent_id,name,shape) VALUES('{plan_one}','{first_project}','{west}','West child','[[0,0],[1,0],[1,1]]');",
    f"UPDATE public.site_map_zones SET map_id='{plan_two}' WHERE id='{west}';",
    '22023',
)
assert sql(f"""SELECT count(*) FROM public.site_map_zones c JOIN public.site_map_zones p ON p.id=c.parent_id
 WHERE c.map_id<>p.map_id""") == '0'

# The plan lock only helps a writer that re-reads after waiting, which only
# READ COMMITTED does, so adding or moving areas is refused at other levels.
try:
    sql(f"BEGIN ISOLATION LEVEL REPEATABLE READ; UPDATE public.site_map_zones SET parent_id='{west}' WHERE id='{south}'; COMMIT;")
    raise AssertionError('a REPEATABLE READ area move was accepted')
except subprocess.CalledProcessError as error:
    assert 'READ COMMITTED' in error.stderr, error.stderr
assert sql(f"SELECT parent_id IS NULL FROM public.site_map_zones WHERE id='{south}'") == 't'
assert sql(f"BEGIN ISOLATION LEVEL REPEATABLE READ; UPDATE public.site_map_zones SET name='South yard' WHERE id='{south}'; COMMIT; SELECT name FROM public.site_map_zones WHERE id='{south}';") == 'South yard'
print('Concurrency passed: areas are added or moved only at READ COMMITTED; renames work at any level', flush=True)


# Two phones packing at once: crossing nests cannot make a loop, and one item
# cannot land in two crates.
def pack(operation, payload):
    return f"""SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);
SELECT public.apply_field_operation('{operation}','{first_project}','pack','{payload}');"""


sql('BEGIN;' + pack('21000000-0000-4000-8000-000000000001', '{"unitCode":"HU-RACEA"}') + 'COMMIT;')
sql('BEGIN;' + pack('21000000-0000-4000-8000-000000000002', '{"unitCode":"HU-RACEB"}') + 'COMMIT;')
overlap(
    'crossing crate packs cannot make a loop',
    pack('21000000-0000-4000-8000-000000000003', '{"unitCode":"HU-RACEA","add":["HU-RACEB"]}'),
    pack('21000000-0000-4000-8000-000000000004', '{"unitCode":"HU-RACEB","add":["HU-RACEA"]}'),
    '22023',
)
assert sql("SELECT count(*) FROM public.handling_units WHERE code IN ('HU-RACEA','HU-RACEB') AND parent_id IS NOT NULL") == '1'
sql(f"""INSERT INTO public.inventory_records(project_id,qr_code,inventory_item,count_status,source)
 VALUES('{first_project}','RACE-ITEM','Race valve','counted','field');""")
overlap(
    'one item cannot be packed into two crates at once',
    pack('21000000-0000-4000-8000-000000000005', '{"unitCode":"HU-RACEC","add":["RACE-ITEM"]}'),
    pack('21000000-0000-4000-8000-000000000006', '{"unitCode":"HU-RACED","add":["RACE-ITEM"]}'),
    '22023',
)
assert sql("SELECT count(*) FROM public.handling_unit_contents WHERE tag='RACE-ITEM' AND removed_at IS NULL") == '1'


# Two loads planned at the same moment can't both take the same crate.
sql(f"""
INSERT INTO public.places(id,kind,name) VALUES('9c111111-1111-4111-8111-111111111111','outside_shop','Race Shop');
INSERT INTO public.loads(id,project_id,load_number,started_in_field) VALUES
 ('1e000000-0000-4000-8000-000000000001','{first_project}','L-0001',true),('1e000000-0000-4000-8000-000000000002','{first_project}','L-0002',true);
INSERT INTO public.load_stops(id,project_id,load_id,seq,place_id) VALUES
 ('5e000000-0000-4000-8000-000000000001','{first_project}','1e000000-0000-4000-8000-000000000001',1,'9c111111-1111-4111-8111-111111111111'),
 ('5e000000-0000-4000-8000-000000000002','{first_project}','1e000000-0000-4000-8000-000000000002',1,'9c111111-1111-4111-8111-111111111111');
""")


def plan(operation, load, stop):
    return f"""SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);
SELECT public.apply_field_operation('{operation}','{first_project}','load_plan',
 '{{"loadId":"{load}","add":[{{"code":"HU-RACEC","dropoffStopId":"{stop}"}}]}}');"""


overlap(
    'two loads cannot take the same crate at once',
    plan('22000000-0000-4000-8000-000000000001', '1e000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000001'),
    plan('22000000-0000-4000-8000-000000000002', '1e000000-0000-4000-8000-000000000002', '5e000000-0000-4000-8000-000000000002'),
    '22023',
)
assert sql("SELECT count(*) FROM public.load_lines WHERE tag='HU-RACEC' AND status='planned'") == '1'


# Two phones receiving one tag at once, typed in different capitals: one
# receipt, and the other is told the tag is already received.
def receive(operation, tag):
    return f"""SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);
SELECT public.apply_field_operation('{operation}','{first_project}','receiving',
 '{{"qrCodeValue":"{tag}","material":{{"material_type":"Valve","qty":1}},"decision":{{"status":"accepted"}},
  "inspection":{{"condition":"good"}},"location":{{"location_id":"{rack}"}}}}');"""


rack = sql(f"INSERT INTO public.locations(project_id,zone,row,rack) VALUES('{first_project}','R','1','1') RETURNING id")
overlap(
    'one tag cannot be received twice at once, whatever its capitals',
    receive('23000000-0000-4000-8000-000000000001', 'RACE-TAG'),
    receive('23000000-0000-4000-8000-000000000002', 'race-tag'),
    '22023',
)
assert sql("SELECT count(*) FROM public.qr_codes WHERE lower(code_value)='race-tag'") == '1'
assert sql("SELECT count(*) FROM public.materials m JOIN public.qr_codes q ON q.id=m.qr_code_id WHERE lower(q.code_value)='race-tag'") == '1'


# Receiving and counting one tag at once, in a project with no site plan:
# the count waits for the receipt and is linked to it, so the item doesn't
# end up with two records.
second_project = 'b3333333-3333-4333-8333-333333333333'
sql(f"""INSERT INTO public.projects(id,name) VALUES('{second_project}','Race Two');
INSERT INTO public.user_projects(user_id,project_id) VALUES('f1111111-1111-4111-8111-111111111111','{second_project}');""")
second_rack = sql(f"INSERT INTO public.locations(project_id,zone,row,rack) VALUES('{second_project}','R','1','1') RETURNING id")


def as_worker(operation, project, action, payload):
    return f"""SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);
SELECT public.apply_field_operation('{operation}','{project}','{action}','{payload}');"""


overlap(
    'a count made while the tag is being received is linked to the receipt',
    as_worker('23000000-0000-4000-8000-000000000003', second_project, 'receiving',
              '{"qrCodeValue":"RACE-77","material":{"material_type":"Valve","qty":1},"decision":{"status":"accepted"},'
              f'"inspection":{{"condition":"good"}},"location":{{"location_id":"{second_rack}"}}}}'),
    as_worker('23000000-0000-4000-8000-000000000004', second_project, 'count', '{"tag":"race-77","name":"Race valve","quantity":"1"}'),
    '00000',
)
assert sql("SELECT count_status||'|'||(receiving_record_id IS NOT NULL) FROM public.inventory_records WHERE lower(qr_code)='race-77'") == 'received|true'


# Completing a project while a crew adds a load to it: completing waits, then
# refuses, so no load is left open in a completed project.
overlap(
    'a project cannot be completed while a load is being added to it',
    as_worker('24000000-0000-4000-8000-000000000001', second_project, 'load_save', '{"loadId":"1f000000-0000-4000-8000-000000000001"}'),
    f"UPDATE public.projects SET status='completed' WHERE id='{second_project}';",
    '22023',
)
assert sql(f"SELECT status FROM public.projects WHERE id='{second_project}'") == 'active'
PY
