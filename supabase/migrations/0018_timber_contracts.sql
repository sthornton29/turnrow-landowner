-- ============================================================================
-- Turnrow Landowner: Migration 0018
-- Timber sale contracts and logger settlements, Southeast-shaped:
--
-- - timber_sales.harvest_type: the cutting type (clearcut, first/second
--   thinning, select cut, salvage), nullable because old sales predate it.
-- - timber_sales.delivered_net: delivered-price arrangements (mill price
--   minus cut-and-haul) model as pay_as_cut with per-product NET rates
--   and this flag; no separate structure.
-- - Allocation of dollars/tons across the linked stands:
--     timber_sales.allocation_method: by_acres (default) | manual | none
--     timber_sale_stands.allocation_pct: the manual percentages
--     timber_settlements.allocation: per-settlement jsonb override
--       ({ "method": "by_acres" | "manual" | "none",
--          "percents": { "<stand_id>": 60, ... } }); null inherits the
--       sale's method. Allocation math lives in lib/timberAllocation.ts.
-- - timber_settlements period columns for statements covering a date
--   range (weekly/biweekly logger or mill settlements).
--
-- Product classes, $/ton vs $/MBF rate units with log scale, and richer
-- settlement lines live in the existing stumpage_rates / lines jsonb
-- (shapes documented in lib/leaseLogic.ts; legacy rows keep reading).
-- Run after 0017.
-- ============================================================================

set search_path = public, extensions;

alter table public.timber_sales
  add column harvest_type text check (harvest_type in
    ('clearcut', 'first_thinning', 'second_thinning', 'select_cut',
     'salvage', 'other')),
  add column delivered_net boolean not null default false,
  add column allocation_method text not null default 'by_acres'
    check (allocation_method in ('by_acres', 'manual', 'none'));

alter table public.timber_sale_stands
  add column allocation_pct numeric;

alter table public.timber_settlements
  add column allocation jsonb,
  add column period_start date,
  add column period_end date;
