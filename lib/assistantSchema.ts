// Compact schema digest for the data assistant's run_sql tool: the
// tenant-visible tables and views only. Hand-curated from the migrations:
// enough for the model to write sensible SELECTs; a wrong guess comes back
// as a SQL error it can correct. Isolation note: every query runs as the
// user through RLS (assistant_query is SECURITY INVOKER); this text is
// documentation, not a security boundary.

export const ASSISTANT_SCHEMA_SUMMARY = `
This organization's PostgreSQL tables and views (query with run_sql; you only ever see this organization's rows).
Acres columns are computed from geometry in PostGIS. Prefer the *_geo views for land; they carry acres and GeoJSON.

LAND
- properties_geo(id, name, county, state, notes, acres, fsa_numbers text[], entity_id, boundary_geojson)
- parcels_geo(id, property_id, parcel_number, county, notes, acres, deeded_acres, source, boundary_geojson)
- fields_geo(id, property_id, name, notes, acres, irrigated_acres, boundary_geojson)   -- "Ag Fields" in the app; dryland = acres - irrigated_acres
- pastures_geo(id, property_id, name, notes, acres)   -- shown to users as "Pasture/Grassland"
- wetlands_geo(id, property_id, name, notes, acres)   -- open wetlands only; forested bottomland is a timber stand
- timber_stands_geo(id, property_id, name, stand_type 'planted_pine'|'natural_pine'|'hardwood'|'mixed'|'other', species, year_established, site_index, last_thinning_year, last_burn_year, notes, acres)
- cemeteries_geo(id, property_id, name, notes, acres (polygons only), geom_geojson)   -- a plot or a single marker
- maintenance_issues_geo(id, property_id nullable, field_id nullable, issue_type 'wash'|'sinkhole'|'broken_terrace'|'road_washout'|'other', label, notes, severity 'low'|'medium'|'high' nullable, status 'open'|'resolved', resolved_at, acres, geom_geojson, created_at)   -- problems needing attention, NOT land
- roads_geo(id, property_id, name, road_type 'gravel'|'dirt'|'paved'|'field_road'|'other', notes, length_feet, miles)
- easements_geo(id, property_id nullable, name, easement_type (powerline, pipeline, waterline_sewer, telecom_fiber, access_row, public_road_row, railroad, drainage, flowage, conservation, cemetery_access, construction_temp, solar_wind, other), relationship 'burdens_this_property'|'benefits_this_property', holder, recorded_ref, expiration_date, width_ft, elevation_ft, program, restrictions, notes, acres (polygons), length_feet, miles (lines))
- assets_geo(id, property_id nullable, asset_type (well, irrigation_pivot, underground_pipe, riser, shop, shed, barn, grain_bin, house, fence, pond_dam, other), name, year_installed, condition, estimated_value, notes, details jsonb, parent_asset_id, is_active, geom_geojson)
- entities(id, name, entity_type 'individual'|'llc'|'corporation'|'partnership'|'trust'|'estate'|'other', notes)   -- ownership level above properties (properties.entity_id)
- entity_aliases(id, entity_id, alias, normalized_alias, source_county, source_state)

TENANTS, LEASES, INCOME
- tenants(id, name, contact_person, phone, email, mailing_address, insurance_on_file bool, insurance_expires date, notes)
- leases(id, tenant_id, lease_type 'agricultural'|'hunting', name, status 'draft'|'active'|'expired'|'terminated', start_date, end_date, auto_renew, termination_notice_days, rent_structure 'cash'|'flex'|'crop_share'|null, terms jsonb, payment_schedule jsonb, special_provisions)
  terms jsonb keys: cash rate_per_acre / lump_sum; flex base_rate_per_acre, bonus_description; crop_share landowner_share_pct, shares_expenses, expense_share_pct; price_method; gov_payment_share_pct
- lease_lands(id, lease_id, property_id, field_id nullable, leased_acres)   -- total leased acres rolls up from here
- lease_year_assumptions(id, lease_id, year, data jsonb)   -- per-year projections (crops array with acres, expected_yield, expected_price)
- expected_payments(id, lease_id nullable, timber_sale_id nullable, year, label, due_date, expected_amount)
- payments(id, lease_id nullable, timber_sale_id nullable, expected_payment_id nullable, received_date, amount, method, check_number, memo)
  NOTE: payment status (upcoming, due soon, past due, paid, partial) is computed in the app, not stored; prefer income_summary for projections.

TIMBER SALES
- timber_sales(id, sale_name, buyer_name, buyer_tenant_id, sale_type 'lump_sum'|'pay_as_cut', status 'active'|'completed'|'expired', harvest_type, contract_date, harvest_deadline, performance_deposit, sale_acres, lump_sum_price, stumpage_rates jsonb, payment_schedule jsonb, delivered_net bool, allocation_method 'by_acres'|'manual'|'none', notes)
- timber_sale_stands(id, timber_sale_id, timber_stand_id, allocation_pct)
- timber_settlements(id, timber_sale_id, settlement_date, period_start, period_end, lines jsonb, total_amount, check_number, allocation jsonb)   -- pay-as-cut receipts; count directly as received timber income

PROPERTY TAXES
- tax_statements(id, tax_year, county, state, authority_name, account_number, account_kind, taxpayer_name_printed, care_of_printed, entity_id nullable, entity_evidence, source_document_id, amount_due (the statement total), line_total, reconciled bool, due_date, delinquent_date, notes)   -- the HEADER: how the county billed; one statement can cover many parcels
- tax_statement_lines(id, tax_statement_id, line_no, tax_year, line_type 'real_property'|'personal_property', identifiers jsonb [{label, kind, value, normalized}], appraised_value, assessed_value, tax_due, exemptions, legal_description, property_address, acres, parcel_id nullable (unmatched lines await a parcel), match_source, match_evidence, confirmed bool)   -- one line per parcel block on the statement; a parcel is covered for a year when a real_property line links to it
- tax_payments(id, tax_statement_id, paid_date, amount, method, memo)   -- payments apply to the whole statement; allocate to parcels by line tax_due share
- parcel_identifiers(id, parcel_id, kind 'parcel_number'|'ppin'|'account_number'|'key_number'|'receipt_number'|..., label, value, normalized, source 'county_import'|'tax_statement'|'manual', first_seen_at, last_seen_at)   -- every number a county prints for a parcel
- entity_accounts(id, county, state, account_number, entity_id, taxpayer_name_printed, confirmed_at)   -- recurring statement accounts registered to entities
- county_tax_defaults(id, county, state, due_month, due_day, delinquent_month, delinquent_day)
  NOTE: tax status (paid, partial, unpaid, delinquent) is computed from payments vs amount_due; prefer taxes_status.

DOCUMENTS
- documents(id, entity_type ('property','parcel','field','pasture','wetland','easement','timber_stand','road','asset','entity','tenant','lease','timber_sale','tax_statement'), entity_id, file_name, storage_path, content_type, size_bytes, doc_type (deed_warranty, deed_quitclaim, deed_timber, deed_mineral, title_insurance, title_opinion, closing_statement, probate_estate, survey_plat, legal_description, easement_deed, mortgage_dot, lien_release, fsa_156ez, fsa_map, crp_contract, nrcs_conservation_plan, wetland_determination, hel_determination, appraisal, timber_cruise, management_plan, soil_survey, insurance_policy, hunting_agreement, current_use_application, other), title, extracted jsonb, extracted_at, extraction_reviewed, created_at)

GOVERNMENT PAYMENTS (FSA)
- fsa_farms(id, farm_number, state, county, farmland_acres, cropland_acres, dcp_cropland_acres, notes)
- fsa_farm_properties(id, fsa_farm_id, property_id, allocation_pct)
- fsa_base_acres(id, fsa_farm_id, commodity (corn, soybeans, wheat, seed_cotton, grain_sorghum, oats, barley, peanuts, canola, sesame), base_acres, plc_yield, tract_numbers text[])
- fsa_elections(id, fsa_farm_id, commodity, program_year, election 'plc'|'arc_co'|'arc_ic')   -- default PLC when no row
  NOTE: projected ARC/PLC payments are computed by gov_payments_summary, never stored.

TENANT FARM DATA (shared by the farmer's own software; read-only here)
- farm_connections(id, label, status 'active'|'error'|'revoked', operation_name, landowner_name, field_count, last_synced_at, entities jsonb [{id, name, field_count}] the tenant's farming entities)
- field_mappings(id, farm_connection_id, remote_field_id, remote_name, remote_acres, remote_farm, remote_entity_id, remote_entity_name, local_field_id nullable, local_property_id nullable, status 'suggested'|'confirmed'|'ignored')
- farm_field_data(id, farm_connection_id, remote_field_id, crop_year, crop, planted_acres, irrigated_acres, dryland_acres, planting_date, varieties jsonb, harvested_acres, production_units (null when yields are not shared), production_unit 'bu'|'lbs', yield_shared, remote_entity_id, remote_entity_name the tenant's farming entity operating the field)
- farm_marketing_prices(id, farm_connection_id, crop, crop_year, projected_avg_price, unit 'usd_per_bu'|'cents_per_lb', is_final, as_of, remote_entity_id null = the whole operation, remote_entity_name)
- farm_projected_yields(id, farm_connection_id, remote_field_id, crop, crop_year, planted_acres, yield_per_acre, unit 'bu_per_ac'|'lbs_per_ac', basis 'expected'|'actual', practices jsonb, remote_entity_id)
- tenants(id, name, contact_person, phone, email, farm_connection_id nullable, farm_entity_id nullable, farm_entity_name nullable)   -- a tenant may be one farming entity of one connection

Tips: join land to ownership via properties_geo.entity_id -> entities.id; route parcels to properties via parcels_geo.property_id; sum acres with round(sum(acres)::numeric, 1).
`;
