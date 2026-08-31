// Test-only in-memory stand-in for the supabase client: enough of the
// PostgREST builder chain (select/insert/update/upsert/delete with
// eq/neq/in/is/order/limit/single/maybeSingle) for the sync and drift
// suites. Grows the fakeTenants pattern from farmSyncTenants.test.ts to
// many tables. Never imported by app code.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

interface Filter {
  op: "eq" | "neq" | "is" | "in";
  col: string;
  value: unknown;
}

export interface FakeDb {
  client: unknown;
  tables: Record<string, Row[]>;
  // Every filter applied to a read, for org-scoping assertions.
  reads: Array<{ table: string; filters: Filter[] }>;
  // Make the next write on a table fail with this message.
  failOn: (table: string, op: "insert" | "update" | "upsert" | "delete", message: string) => void;
}

let idCounter = 0;

export function fakeDb(initial: Record<string, Row[]>): FakeDb {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(initial)) {
    tables[name] = rows.map((r) => ({ ...r }));
  }
  const reads: FakeDb["reads"] = [];
  const failures = new Map<string, string>();

  const matches = (row: Row, filters: Filter[]) =>
    filters.every((f) => {
      const v = row[f.col];
      if (f.op === "eq") return v === f.value;
      if (f.op === "neq") return v !== f.value;
      if (f.op === "is") return v === f.value;
      return Array.isArray(f.value) && (f.value as unknown[]).includes(v);
    });

  const takeFailure = (table: string, op: string) => {
    const key = `${table}:${op}`;
    const message = failures.get(key);
    if (message) failures.delete(key);
    return message ?? null;
  };

  function from(table: string) {
    const rows = (tables[table] ??= []);

    function readBuilder() {
      const filters: Filter[] = [];
      let take: number | null = null;
      const result = () => {
        reads.push({ table, filters: [...filters] });
        let out = rows.filter((r) => matches(r, filters)).map((r) => ({ ...r }));
        if (take !== null) out = out.slice(0, take);
        return out;
      };
      const b = {
        eq(col: string, value: unknown) {
          filters.push({ op: "eq", col, value });
          return b;
        },
        neq(col: string, value: unknown) {
          filters.push({ op: "neq", col, value });
          return b;
        },
        is(col: string, value: unknown) {
          filters.push({ op: "is", col, value });
          return b;
        },
        in(col: string, value: unknown[]) {
          filters.push({ op: "in", col, value });
          return b;
        },
        order() {
          return b;
        },
        limit(n: number) {
          take = n;
          return b;
        },
        async single() {
          const out = result();
          return { data: out[0] ?? null, error: out.length === 0 ? { message: "no rows" } : null };
        },
        async maybeSingle() {
          return { data: result()[0] ?? null, error: null };
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        then(resolve: (v: { data: Row[]; error: null }) => any) {
          return Promise.resolve({ data: result(), error: null }).then(resolve);
        },
      };
      return b;
    }

    function writeResult(op: "insert" | "update" | "upsert" | "delete", apply: () => void) {
      const message = takeFailure(table, op);
      if (!message) apply();
      return { data: null, error: message ? { message } : null };
    }

    return {
      select() {
        return readBuilder();
      },
      insert(row: Row | Row[]) {
        const list = Array.isArray(row) ? row : [row];
        const inserted: Row[] = [];
        const res = writeResult("insert", () => {
          for (const r of list) {
            const withId = { id: r.id ?? `id${++idCounter}`, ...r };
            rows.push(withId);
            inserted.push(withId);
          }
        });
        return {
          select: () => ({
            async single() {
              return res.error ? { data: null, error: res.error } : { data: { ...inserted[0] } , error: null };
            },
          }),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          then(resolve: (v: typeof res) => any) {
            return Promise.resolve(res).then(resolve);
          },
        };
      },
      update(patch: Row) {
        const filters: Filter[] = [];
        const b = {
          eq(col: string, value: unknown) {
            filters.push({ op: "eq", col, value });
            return b;
          },
          in(col: string, value: unknown[]) {
            filters.push({ op: "in", col, value });
            return b;
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          then(resolve: (v: { data: null; error: { message: string } | null }) => any) {
            const res = writeResult("update", () => {
              for (const r of rows) if (matches(r, filters)) Object.assign(r, patch);
            });
            return Promise.resolve(res).then(resolve);
          },
        };
        return b;
      },
      upsert(row: Row | Row[], opts?: { onConflict?: string }) {
        const list = Array.isArray(row) ? row : [row];
        const keys = (opts?.onConflict ?? "id").split(",");
        const res = writeResult("upsert", () => {
          for (const r of list) {
            const hit = rows.find((x) => keys.every((k) => x[k] === r[k]));
            if (hit) Object.assign(hit, r);
            else rows.push({ id: r.id ?? `id${++idCounter}`, ...r });
          }
        });
        return {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          then(resolve: (v: typeof res) => any) {
            return Promise.resolve(res).then(resolve);
          },
        };
      },
      delete() {
        const filters: Filter[] = [];
        const b = {
          eq(col: string, value: unknown) {
            filters.push({ op: "eq", col, value });
            return b;
          },
          in(col: string, value: unknown[]) {
            filters.push({ op: "in", col, value });
            return b;
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          then(resolve: (v: { data: null; error: { message: string } | null }) => any) {
            const res = writeResult("delete", () => {
              const keep = rows.filter((r) => !matches(r, filters));
              rows.length = 0;
              rows.push(...keep);
            });
            return Promise.resolve(res).then(resolve);
          },
        };
        return b;
      },
    };
  }

  return {
    client: { from },
    tables,
    reads,
    failOn: (table, op, message) => failures.set(`${table}:${op}`, message),
  };
}
