-- Support Testing proposals carry a required link to the PM's own
-- SharePoint-hosted Support Request Form document (pasted in, not
-- uploaded through this app — there's no automated SharePoint write path).
alter table projects
  add column support_request_form_link text;
