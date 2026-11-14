import { describe, expect, it } from "vitest";
import { cleanFileName, displayTitle, proposeTitle, yearOf } from "./documentTitle";

describe("proposeTitle", () => {
  it("names a deed grantor to grantee with the year", () => {
    expect(
      proposeTitle(
        "deed_warranty",
        { grantor: "John Smith", grantee: "Jane Jones", execution_date: "2014-03-02" },
        "x.pdf"
      )
    ).toBe("Warranty Deed - John Smith to Jane Jones (2014)");
  });
  it("drops missing deed pieces cleanly", () => {
    expect(proposeTitle("deed_quitclaim", { grantor: "John Smith" }, "x.pdf", { uploadedAt: "2020-01-01" })).toBe(
      "Quitclaim Deed - John Smith (2020)"
    );
    expect(proposeTitle("deed_quitclaim", { grantee: "Jane" }, "x.pdf")).toBe("Quitclaim Deed - Jane");
  });
  it("names a plat by property, acres and year", () => {
    expect(
      proposeTitle("survey_plat", { surveyor: "J. Doe", stated_acres: 120, survey_date: "2009-05-05" }, "x.pdf", {
        propertyName: "River Place",
      })
    ).toBe("Survey Plat - River Place, 120.0 acres (2009)");
  });
  it("names 156EZ by farm number", () => {
    expect(proposeTitle("fsa_156ez", { farms: [{ farm_number: "1234" }] }, "x.pdf", { uploadedAt: "2024-08-01" })).toBe(
      "FSA-156EZ - Farm 1234 (2024)"
    );
    expect(proposeTitle("fsa_156ez", { farms: [{ farm_number: "1" }, { farm_number: "2" }] }, "x.pdf")).toBe(
      "FSA-156EZ - Farms 1, 2"
    );
  });
  it("names title insurance with amount and year", () => {
    expect(
      proposeTitle(
        "title_insurance",
        { insurer: "First American", policy_amount: 250000, policy_date: "2014-01-01" },
        "x.pdf",
        { propertyName: "River Place" }
      )
    ).toBe("Title Insurance - River Place ($250,000.00, 2014)");
  });
  it("leaves the upload year off when nothing was read from the document", () => {
    const opts = { uploadedAt: "2026-11-14T15:00:00Z", propertyName: "Home Place" };
    expect(proposeTitle("other", null, "scan.pdf", opts)).toBe("Other - Home Place");
    expect(proposeTitle("other", {}, "scan.pdf", opts)).toBe("Other - Home Place");
    // An empty review form (every field blank) is still nothing read,
    // whatever else is stored beside it.
    expect(
      proposeTitle(
        "appraisal",
        {
          scan_kind: "generic",
          unsure_fields: [],
          pages_scanned: 3,
          total_pages: 3,
          title: null,
          parties: "",
          document_date: null,
          amount: null,
          summary: " ",
        },
        "scan.pdf",
        opts
      )
    ).toBe("Appraisal - Home Place");
    expect(proposeTitle("survey_plat", { stated_acres: null, surveyor: null }, "scan.pdf", opts)).toBe(
      "Survey Plat - Home Place"
    );
    // The document's own date still shows, and so does the upload year
    // once something was read.
    expect(proposeTitle("other", { document_date: "1987-03-02" }, "scan.pdf", opts)).toBe("Other - Home Place (1987)");
    expect(proposeTitle("other", { parties: "John Smith" }, "scan.pdf", opts)).toBe("Other - Home Place (2026)");
  });
  it("falls back to the cleaned file name", () => {
    expect(proposeTitle("appraisal", null, "my_farm-appraisal (1).PDF")).toBe("Appraisal - my farm appraisal (1)");
    expect(proposeTitle("other", {}, "scan_0012.pdf")).toBe("Other - scan 0012");
  });
});

describe("helpers", () => {
  it("cleans file names", () => {
    expect(cleanFileName("Deed__Smith-2014.pdf")).toBe("Deed Smith 2014");
  });
  it("reads years", () => {
    expect(yearOf("03/02/2014")).toBe("2014");
    expect(yearOf("")).toBeNull();
  });
  it("displays the title or the cleaned name", () => {
    expect(displayTitle({ title: "  ", file_name: "a_b.pdf" })).toBe("a b");
    expect(displayTitle({ title: "Deed", file_name: "a_b.pdf" })).toBe("Deed");
  });
});
