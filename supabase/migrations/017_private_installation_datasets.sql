-- Legacy installation snapshots belong to a project and must not be public files.
BEGIN;
CREATE TABLE public.installation_datasets (
  project_id uuid NOT NULL REFERENCES public.projects(id),
  dataset_key text NOT NULL CHECK (dataset_key IN ('audit_data', 'discipline_summary')),
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, dataset_key)
);
ALTER TABLE public.installation_datasets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.installation_datasets FROM anon, authenticated;
GRANT SELECT ON public.installation_datasets TO authenticated;
GRANT ALL ON public.installation_datasets TO service_role;
CREATE POLICY installation_project_read ON public.installation_datasets
  FOR SELECT TO authenticated USING (public.has_project_access(project_id));
COMMIT;
