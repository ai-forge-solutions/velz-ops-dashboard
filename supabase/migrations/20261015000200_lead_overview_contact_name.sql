-- Add a lead-specific contact name to the existing dashboard read model.
-- Preserve all existing columns/order/ACLs. No base-table data writes or new grants.
-- Do not borrow a different person's name merely because they share a company.
CREATE OR REPLACE VIEW public.v_lead_overview AS
 SELECT l.id AS lead_id,
    b.id AS brand_id,
    COALESCE(b.name, l.store_name) AS brand_name,
    COALESCE(b.domain, normalize_domain(l.domain)) AS domain,
    l.status,
    l.fit_score,
    l.monthly_revenue_usd,
    l.monthly_visits,
    l.employees_count,
    l.product_count,
    l.meta_ads_active,
    l.primary_email,
    l.founder_owner,
    l.suggested_tool,
    l.created_at AS lead_created_at,
    l.updated_at AS lead_updated_at,
    l.archived_at,
    l.archived_by,
    l.archive_reason,
    l.archive_source,
    l.archive_source_id,
    l.icp_key,
    s.name AS icp_name,
    COALESCE(
      (SELECT NULLIF(btrim(c.person_name), '')
         FROM public.brand_contacts c
        WHERE NULLIF(btrim(c.person_name), '') IS NOT NULL
          AND (c.source_lead_id = l.id OR
               (c.source_lead_id IS NULL AND c.brand_id = l.brand_id
                AND c.kind = 'email' AND lower(c.value) = lower(l.primary_email::text)))
        ORDER BY (c.source_lead_id = l.id) DESC NULLS LAST,
                 (c.kind = 'email' AND lower(c.value) = lower(l.primary_email::text)) DESC NULLS LAST,
                 c.updated_at DESC NULLS LAST, c.created_at DESC NULLS LAST, c.id
        LIMIT 1),
      NULLIF(btrim(concat_ws(' ',
        NULLIF(btrim(l.raw_payload ->> 'First name'), ''),
        NULLIF(btrim(l.raw_payload ->> 'Last name'), ''))), '')
    ) AS contact_name
   FROM leads l
     LEFT JOIN brands b ON b.id = l.brand_id
     LEFT JOIN icp_segments s ON s.key = l.icp_key;
COMMENT ON COLUMN public.v_lead_overview.contact_name IS
 'Contact full name for this lead: source-linked contact or matching unassigned email contact; source CSV name fallback. Never a company-wide arbitrary contact.';
NOTIFY pgrst, 'reload schema';
