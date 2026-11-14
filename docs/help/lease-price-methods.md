---
title: Lease price methods and projections
route: /leases
group: Leases
order: 2
updated: 2026-11-14
keywords: price method, manual, tenant average, rma, benchmark, crop benchmark, projected price, harvest price, custom recipe, design recipe, compute price, use this price, assumptions, expected yield, expected price, shared expenses, irrigated, dryland, blended, multi crop, canola, wheat, tenant data panel, use row, use all, projected rent, incomplete, amber, saved automatically, sync
---
## Why a price matters

Crop share rent depends on a crop price. Each crop share and flex lease records **how** its price is established: the **Price method** in the lease terms. On a crop share lease the method decides which price helper shows under each crop row of a year's assumptions. A price a helper fills in is amber until you press **Save**.

One thing saves by itself. On a Draft or Active crop share lease connected to your tenant's farm data, the tenant's acres, yields, and prices are written into the year at every sync, whatever the method. They fill blank values and values that came from the tenant before. A number you typed is never replaced.

On a flex lease the rent is the base rate times leased acres plus a bonus estimate you type each year. The price helpers show there for reference only.

## The methods

- **Manual (enter prices yourself)**: you type the price.
- **Tenant's average price (farm connection)**: the tenant's farm software shares their projected or final average price for the crop, if they turned that sharing on. It shows in the Tenant data panel.
- **RMA insurance benchmark (public data)**: the public USDA crop insurance projected price, harvest price, or the average of the two, for a crop and state. In the lease terms, tap **+ Add crop benchmark** and enter the crop (corn, soybeans, wheat, cotton, or canola), the two-letter state, and which price to use. No connection needed. Each crop row then shows the benchmark with **Use this price**.
- **Custom recipe (from the lease's pricing clause)**: a formula built once from the lease's pricing clause (for example the average of two elevator quotes less a basis). On the lease page tap **Set up recipe**, check the clause, tap **Design recipe**, review the description, inputs, and formula, then **Confirm and save recipe**. Each year, **Compute price** asks for any numbers you must type, shows the arithmetic, and offers **Use this price**. The same recipe and inputs always give the same number.

## Year assumptions

For each year of the lease, a crop share lease holds one entry per crop grown on the leased ground: crop, practice (Blended, Irrigated, or Dryland), acres, expected yield, expected price, and your share of shared expenses. **+ Add crop** adds an entry. Two crops on the same ground (wheat then soybeans) are two entries. Projected rent sums them. An entry missing acres, yield, or price keeps the whole year marked Incomplete rather than guessing. Shared expenses are subtracted only when the lease terms say the landowner shares expenses.

## The Tenant data panel

When land on this lease is matched to a connected tenant's fields (Field mapping), a **Tenant data** panel sits above the year rows. For each lease year with shared plantings it lists every crop the tenant planted on the leased ground: acres, yield (projected, or actual once every field of that crop is harvested), and average price (projected or final). A cell reads **Not shared** when the farmer has that sharing off.

On a crop share lease, **Use**, **Use row**, and **Use all** fill the year's entries in amber for you to save. **Use all** never replaces a value you already saved. On a flex lease the panel is for reference.

## Common questions

- **The RMA price is blank.** The card shows each price as yet to start, in discovery, or released. Before discovery starts there is no number. With the average chosen, the projected price is used alone until the harvest price starts. If RMA lists no offer for the crop in that state, the card says so.
- **The RMA card says the crop is not mapped.** Type the benchmark's crop as corn, soybeans, wheat, cotton, or canola.
- **I chose Tenant's average price and see no price.** The price shows in the Tenant data panel. The panel is missing when no land on the lease is matched to a connected tenant's fields, and the price reads Not shared when the farmer has price sharing off.
- **The tenant's price is for a different crop.** Prices match crops strictly. A crop the tenant planted that is not in the year's entries is marked "not in this year's crops" and never fills another crop's price.
