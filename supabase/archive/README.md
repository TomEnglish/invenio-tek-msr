# Archive: do not run

These are the hand-run SQL scripts the database was originally built with, kept for history only. Everything they created is now defined in `../migrations`, mainly `009_msr_table_definitions.sql`.

**Never run any of these against a database.** They are out of date. `setup_schema.sql` in particular starts by dropping tables, and would destroy data.

| File | Originally |
| --- | --- |
| `setup_schema.sql` | Combined “re-runnable” setup script from the MSR repository root. Drops and recreates tables. |
| `schema.sql`, `po_shipment_schema.sql`, `samsara_schema.sql`, `delivery_dates_schema.sql`, `project_schedule_schema.sql`, `inventory_schema.sql` | Per-feature MSR schema scripts |
| `field/fix_users_rls.sql`, `field/make_admins.sql`, `field/sync_users.sql` | One-off fixes from the Field repository |
