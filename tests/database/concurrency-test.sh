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
PY
