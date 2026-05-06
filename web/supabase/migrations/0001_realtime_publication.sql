-- Register tables with the supabase_realtime publication so postgres_changes fires.
-- Without this, client subscriptions silently receive no events.
ALTER PUBLICATION supabase_realtime ADD TABLE projects, slides, render_jobs, renders;
