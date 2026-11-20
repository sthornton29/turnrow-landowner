-- 0055: what a tax bill covers, in the owner's words.
--
-- A personal property bill (business contents, equipment) is taxed to an
-- owner on a county account and never to a parcel, so nothing on the
-- Property Taxes page said what it was: the bill read "1 line" under an
-- account number. Owners write it on the paper bill by hand ("Contents
-- within business", "Dupes (L-19)"). This column holds that label.
--
-- It is one label per county account: the app writes it to every year's
-- statement on the account when it is saved, and fills it in on next
-- year's upload (lib/personalProperty.ts). Any statement can carry one;
-- a personal property bill is where it matters, since it has no parcel
-- or property to name it.

alter table public.tax_statements add column if not exists label text;

comment on column public.tax_statements.label is
  'What the bill covers, in the owner''s words (e.g. "Contents within business"). Kept the same on every statement of one county account.';
